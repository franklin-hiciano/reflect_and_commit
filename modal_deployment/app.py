import os
import tarfile
import shutil
import modal

# 1. Lightweight, pristine image definition
hermes_image = (
    modal.Image.debian_slim(python_version="3.12")
    .apt_install("curl", "git")
    .uv_pip_install("hermes-agent")
    .run_commands("curl -fsSL https://hermes-agent.nousresearch.com/install.sh | bash")
)

nfs = modal.NetworkFileSystem.from_name("hermes-user-memories", create_if_missing=True)
app = modal.App("hermes-multi-tenant-service", image=hermes_image)


@app.function(
    network_file_systems={"/data": nfs}, 
    timeout=180,  # Generous headroom for network/inference loops
    concurrency_limit=1,
    secrets=[
        modal.Secret.from_dict({
            "OPENAI_API_KEY": "freellmapi-49fca99347ad526f2172f80358cbb2e36789b2cbc982f4a0",
            "OPENAI_BASE_URL": "http://34.26.134.74:3001/v1"
        })
    ]
)
@modal.web_endpoint(method="POST")
def chat_with_agent(payload: dict):
    user_id = payload.get("user_id")
    user_message = payload.get("message")
    
    if not user_id or not user_message:
        return {"error": "Missing user_id or message"}, 400

    # Step 1: Create an isolated, high-speed LOCAL disk folder for this user
    local_user_home = f"/tmp/hermes_{user_id}"
    
    if os.path.exists(local_user_home):
        shutil.rmtree(local_user_home)
    os.makedirs(local_user_home, exist_ok=True)

    # Step 2: Dynamically bind the Hermes environment to this local folder
    os.environ["HERMES_HOME"] = local_user_home
    os.chdir(local_user_home)

    # Step 3: Stream user memories from NFS archive into local space (1 fast read operation)
    nfs_archive_dir = "/data/users"
    nfs_archive_path = f"{nfs_archive_dir}/{user_id}_state.tar.gz"
    
    if os.path.exists(nfs_archive_path):
        with tarfile.open(nfs_archive_path, "r:gz") as tar:
            tar.extractall(path=local_user_home)

    # Step 4: Write fresh operational configuration inside the local home
    config_path = os.path.join(local_user_home, "config.yaml")
    config_content = f"""
provider: "custom"
providers:
  custom:
    api_key: "{os.environ.get('OPENAI_API_KEY')}"
    base_url: "{os.environ.get('OPENAI_BASE_URL')}"
    default_model: "gemini-1.5-flash"
"""
    with open(config_path, "w") as f:
        f.write(config_content.strip())

    # ---------------------------------------------------------
    # THE FIX: Remove the injected guardrail string completely.
    # Just pass the raw message to the agent.
    # ---------------------------------------------------------

    # Step 5: Instantiate and execute the chat tracking purely over local SSD
    from run_agent import AIAgent
    agent = AIAgent(quiet_mode=True)
    
    # Pass the unaltered user_message
    response = agent.chat(user_message)

    # Step 6: Bundle updated local state and stream back to the NFS (1 fast write operation)
    os.makedirs(nfs_archive_dir, exist_ok=True)
    with tarfile.open(nfs_archive_path, "w:gz") as tar:
        for item in os.listdir(local_user_home):
            full_path = os.path.join(local_user_home, item)
            tar.add(full_path, arcname=item)

    return {
        "user_id": user_id, 
        "agent_response": response
    }
        # Step 7: Bundle updated local state and stream back to the NFS (1 fast write operation)
    os.makedirs(nfs_archive_dir, exist_ok=True)
    with tarfile.open(nfs_archive_path, "w:gz") as tar:
        for item in os.listdir(local_user_home):
            full_path = os.path.join(local_user_home, item)
            tar.add(full_path, arcname=item)

    return {
        "user_id": user_id, 
        "agent_response": response
    }
