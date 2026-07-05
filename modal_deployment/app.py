import os
import shutil
import modal

# 1. Container Image Definition
hermes_image = (
    modal.Image.debian_slim(python_version="3.12")
    .apt_install("curl", "git")
    .uv_pip_install("hermes-agent")
    .run_commands(
        "curl -fsSL https://hermes-agent.nousresearch.com/install.sh | bash"
    )
)

# 2. Network disk to isolate separate user database states
volume = modal.Volume.from_name("hermes-user-memories", create_if_missing=True)
app = modal.App("hermes-multi-tenant-service", image=hermes_image)


def initialize_hermes_config():
    """Ensures Hermes activates the custom provider and binds env secrets"""
    hermes_dir = os.path.expanduser("~/.hermes")
    os.makedirs(hermes_dir, exist_ok=True)
    
    config_path = os.path.join(hermes_dir, "config.yaml")
    
    # Generate the global configuration block mapping FreeLLMAPI parameters
    config_content = """
provider: "custom"
providers:
  custom:
    api_key: "${OPENAI_API_KEY}"
    base_url: "${OPENAI_BASE_URL}"
    default_model: "auto"
"""
    with open(config_path, "w") as f:
        f.write(config_content.strip())


@app.function(
    volumes={"/data": volume}, 
    timeout=300,
    secrets=[
        # Inject custom endpoint configurations seamlessly into the container environment
        modal.Secret.from_dict({
            "OPENAI_API_KEY": "freellmapi-49fca99347ad526f2172f80358cbb2e36789b2cbc982f4a0",
            "OPENAI_BASE_URL": "http://34.26.134.74:3001/v1"
        })
    ]
)
@modal.web_endpoint(method="POST")
def chat_with_agent(payload: dict):
    """
    Accepts JSON payloads: {"user_id": "user_123", "message": "Hello Agent"}
    """
    user_id = payload.get("user_id")
    user_message = payload.get("message")
    
    if not user_id or not user_message:
        return {"error": "Missing user_id or message"}, 400

    # Locate individual user workspaces inside the network drive
    user_storage_path = f"/data/users/{user_id}/.hermes"
    container_hermes_path = os.path.expanduser("~/.hermes")

    # Hydrate current sandbox context with target user's SQLite memory files
    if os.path.exists(user_storage_path):
        shutil.copytree(user_storage_path, container_hermes_path, dirs_exist_ok=True)
    else:
        os.makedirs(container_hermes_path, exist_ok=True)

    # Force initialization of the configuration mapping layer
    initialize_hermes_config()

    # Invoke Hermes Agent using the updated runtime structure
    from run_agent import AIAgent
    
    agent = AIAgent(quiet_mode=True)
    response = agent.chat(user_message)

    # Sync memory adjustments back to the persistent disk before teardown
    os.makedirs(os.path.dirname(user_storage_path), exist_ok=True)
    shutil.copytree(container_hermes_path, user_storage_path, dirs_exist_ok=True)
    volume.commit()

    return {"user_id": user_id, "agent_response": response}
