// ---------------------------------------------------------------------------
// The entrance. This is the ONLY place in the product allowed to be loud:
// procedurally-grown gothic vines, candlelight, an engraved wordmark. The
// moment you're inside (home / reflect) it all falls silent — near-black,
// system fonts, no ornament. Hermès overdoes the doorway; the shop is calm.
// Nothing here runs unless the landing screen is actually shown.
// ---------------------------------------------------------------------------
(() => {
  const NS = "http://www.w3.org/2000/svg";

  // display fonts are injected lazily — an installed user who never sees the
  // landing never pays for the download.
  function ensureFonts() {
    if (document.getElementById("landingFonts")) return;
    const l = document.createElement("link");
    l.id = "landingFonts"; l.rel = "stylesheet";
    l.href = "https://fonts.googleapis.com/css2?family=Cinzel:wght@500;600&family=EB+Garamond:ital@0;1&family=Grenze+Gotisch:wght@400;500;600&display=swap";
    document.head.appendChild(l);
  }

  function mulberry32(a){return function(){a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;};}
  const el=(t,a)=>{const e=document.createElementNS(NS,t);for(const k in a)e.setAttribute(k,a[k]);return e;};

  function smooth(pts){
    if(pts.length<2)return"";
    let d=`M ${pts[0].x.toFixed(1)} ${pts[0].y.toFixed(1)}`;
    for(let i=0;i<pts.length-1;i++){
      const p0=pts[i-1]||pts[i],p1=pts[i],p2=pts[i+1],p3=pts[i+2]||p2;
      const c1x=p1.x+(p2.x-p0.x)/6,c1y=p1.y+(p2.y-p0.y)/6;
      const c2x=p2.x-(p3.x-p1.x)/6,c2y=p2.y-(p3.y-p1.y)/6;
      d+=` C ${c1x.toFixed(1)} ${c1y.toFixed(1)} ${c2x.toFixed(1)} ${c2y.toFixed(1)} ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`;
    }
    return d;
  }
  function draw(path,len,delay,dur){
    path.style.strokeDasharray=len; path.style.strokeDashoffset=len;
    path.animate([{strokeDashoffset:len},{strokeDashoffset:0}],{duration:dur,delay,easing:"ease-out",fill:"forwards"});
  }
  function pop(node,delay){
    node.style.opacity=0;
    node.animate([{opacity:0,transform:"scale(0)"},{opacity:1,transform:"scale(1)"}],
      {duration:520,delay,easing:"cubic-bezier(.2,.9,.3,1.2)",fill:"forwards"});
  }

  let rnd, svg;
  function ink(){const g=Math.floor(58+rnd()*46);return rnd()<.22?`rgb(${g+34},${g+22},${g-4})`:`rgb(${g},${g},${g+4})`;}
  function leaf(x,y,ang,size){
    const tx=x+Math.cos(ang)*size,ty=y+Math.sin(ang)*size,p=ang+Math.PI/2,w=size*.5;
    const b1x=x+Math.cos(p)*w,b1y=y+Math.sin(p)*w,b2x=x-Math.cos(p)*w,b2y=y-Math.sin(p)*w;
    return `M ${x.toFixed(1)} ${y.toFixed(1)} Q ${b1x.toFixed(1)} ${b1y.toFixed(1)} ${tx.toFixed(1)} ${ty.toFixed(1)} Q ${b2x.toFixed(1)} ${b2y.toFixed(1)} ${x.toFixed(1)} ${y.toFixed(1)} Z`;
  }

  function grow(x,y,ang,len,width,depth,t0){
    const steps=Math.max(6,Math.min(34,Math.round(len/15))),seg=len/steps;
    let angVel=(rnd()-.5)*.14,curveBias=(rnd()-.5)*.05,px=x,py=y,a=ang;
    const pts=[{x,y}],marks=[];
    for(let i=1;i<=steps;i++){
      angVel+=(rnd()-.5)*.09+curveBias; angVel=Math.max(-.32,Math.min(.32,angVel)); a+=angVel;
      px+=Math.cos(a)*seg; py+=Math.sin(a)*seg; pts.push({x:px,y:py});
      marks.push({x:px,y:py,a,frac:i/steps});
    }
    const path=el("path",{d:smooth(pts),fill:"none",stroke:ink(),"stroke-width":width.toFixed(2),"stroke-linecap":"round",opacity:(0.5+depth*0.14).toFixed(2)});
    svg.appendChild(path);
    let L=0;for(let i=1;i<pts.length;i++)L+=Math.hypot(pts[i].x-pts[i-1].x,pts[i].y-pts[i-1].y);
    const dur=520+L*2.1; draw(path,Math.round(L*1.15),t0,dur);

    let side=1;
    for(const m of marks){
      const appear=t0+dur*m.frac;
      if(depth<3 && rnd()<.34 && m.frac>.12 && m.frac<.96){
        const lsize=(9+rnd()*11)*(1-depth*.16), la=m.a+side*(0.7+rnd()*0.5);
        const lp=el("path",{d:leaf(m.x,m.y,la,lsize),fill:ink(),stroke:"none",opacity:(.32+rnd()*.22).toFixed(2)});
        svg.appendChild(lp); pop(lp,appear);
        const vx=m.x+Math.cos(la)*lsize,vy=m.y+Math.sin(la)*lsize;
        const vein=el("path",{d:`M ${m.x.toFixed(1)} ${m.y.toFixed(1)} L ${vx.toFixed(1)} ${vy.toFixed(1)}`,stroke:"rgba(10,10,11,.5)",fill:"none","stroke-width":".7"});
        svg.appendChild(vein); pop(vein,appear+40); side*=-1;
      }
      if(rnd()<.28 && m.frac<.9){
        const ta=m.a+side*1.9,tl=4+rnd()*5,tx=m.x+Math.cos(ta)*tl,ty=m.y+Math.sin(ta)*tl;
        const th=el("path",{d:`M ${m.x.toFixed(1)} ${m.y.toFixed(1)} L ${tx.toFixed(1)} ${ty.toFixed(1)}`,stroke:ink(),fill:"none","stroke-width":(width*.7).toFixed(2),"stroke-linecap":"round",opacity:".5"});
        svg.appendChild(th); draw(th,tl,appear,220);
      }
      if(depth<2 && rnd()<.12 && m.frac>.3){
        let td=`M ${m.x.toFixed(1)} ${m.y.toFixed(1)}`; const dir=rnd()<.5?1:-1,tsz=8+rnd()*8;
        let ca=m.a,cx=m.x,cy=m.y;
        for(let k=1;k<=16;k++){const tt=k/16;ca+=dir*.42;const r=tsz*(1-tt*.6)*.28;cx+=Math.cos(ca)*r;cy+=Math.sin(ca)*r;td+=` L ${cx.toFixed(1)} ${cy.toFixed(1)}`;}
        const tc=el("path",{d:td,fill:"none",stroke:ink(),"stroke-width":(width*.55).toFixed(2),"stroke-linecap":"round",opacity:".45"});
        svg.appendChild(tc); draw(tc,tsz*3,appear,420);
      }
      if(depth<2 && rnd()<.22 && m.frac>.25 && m.frac<.85){
        grow(m.x,m.y,m.a+(rnd()<.5?1:-1)*(0.5+rnd()*0.6),len*(.42+rnd()*.22),width*.66,depth+1,appear);
      }
    }
    const tip=pts[pts.length-1];
    if(depth===0 && rnd()<.5){
      const petals=5+Math.floor(rnd()*2),psz=7+rnd()*4;
      for(let k=0;k<petals;k++){
        const bp=el("path",{d:leaf(tip.x,tip.y,(k/petals)*Math.PI*2,psz),fill:"rgba(201,162,94,.5)",stroke:"none"});
        svg.appendChild(bp); pop(bp,t0+dur+k*40);
      }
      const core=el("circle",{cx:tip.x.toFixed(1),cy:tip.y.toFixed(1),r:3,fill:"#e8c877"});
      svg.appendChild(core); pop(core,t0+dur+petals*40);
    }
  }

  // grown once per showing; a re-show just leaves the existing growth in place
  let planted=false;
  window._growVines = function () {
    ensureFonts();
    svg = document.getElementById("landingVines");
    if (!svg || planted) return;
    const host = document.getElementById("landingScreen");
    const W = host.clientWidth || window.innerWidth, H = host.clientHeight || window.innerHeight;
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    svg.innerHTML = "";
    rnd = mulberry32(20260703);
    const seeds = [
      {x:0,y:0,a:0.55,len:H*0.62},{x:0,y:0,a:0.95,len:W*0.42},
      {x:W,y:0,a:Math.PI-0.55,len:H*0.62},{x:W,y:0,a:Math.PI-0.95,len:W*0.42},
      {x:0,y:H,a:-0.55,len:H*0.62},{x:0,y:H,a:-0.95,len:W*0.4},
      {x:W,y:H,a:Math.PI+0.55,len:H*0.62},{x:W,y:H,a:Math.PI+0.95,len:W*0.4},
      {x:W*0.5,y:0,a:1.9,len:H*0.34},{x:W*0.5,y:H,a:-1.9,len:H*0.34},
      {x:0,y:H*0.5,a:0.1,len:W*0.3},{x:W,y:H*0.5,a:Math.PI-0.1,len:W*0.3},
    ];
    seeds.forEach((s,i)=>{
      const t0=(i%4)*90+Math.floor(i/4)*140;
      grow(s.x,s.y,s.a,s.len,2.1,0,t0);
      grow(s.x,s.y,s.a+(rnd()-.5)*.5,s.len*.7,1.5,0,t0+180);
    });
    host.classList.add("lit");
    planted = true;
  };
  // regrow to fit if the window changes size meaningfully while on the landing
  let rt; window.addEventListener("resize", () => {
    const host = document.getElementById("landingScreen");
    if (!host || !host.classList.contains("on")) return;
    clearTimeout(rt); rt = setTimeout(() => { planted = false; window._growVines(); }, 260);
  });
})();
