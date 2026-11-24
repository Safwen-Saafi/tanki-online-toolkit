// MAIN-world content script: the lobby's picture pass (build-plan 26f, see blueprint/context/lobby-restyle-research.md). After the
// game has drawn its whole lobby picture, src/modules/lobby.ts calls this pass's draw with one frame object, and the pass draws over
// the game's picture with the game's own GL context, reading the game's depth, so what it adds sits behind the tank and the drone
// where it should. It is the lobby probe's own pass (v1.87), ported as it is: the shaders are its text, the stages keep its numbers
// and its order (0a ... 4), and the game's GL state is saved first and put back exactly after, whatever happens. A later lobby
// part fills its own stage without moving the others. 26f1: the depth copy, stage 1 (the time of day colour), stage 1a (the
// hangar floor carried into the road outside) and stage 2 (the atmosphere: the sun's glow; fog, snow on the ground, stars, clouds,
// lightning come with their looks). It also reads the game's own hangar model (the 3ds file of the game's hangar folder, through
// window.fetch, so hangar_files.ts answers it) into triangle lists and pictures. Nothing here spells a game name; nothing is printed.
(function () {
    'use strict';

    // ---- the shaders, the probe's own text ----
    const HASH_GLSL = "uint pcg(uint v){uint s=v*747796405u+2891336453u;uint w=((s>>((s>>28u)+4u))^s)*277803737u;return (w>>22u)^w;}\nfloat rnd(uint k){return float(pcg(k))*(1.0/4294967296.0);}\n";
    const FULL_VS = "#version 300 es\nvoid main(){vec2 p=vec2(gl_VertexID==1?3.:-1.,gl_VertexID==2?3.:-1.);gl_Position=vec4(p,0.,1.);}";
    const DEPTH_GLSL = `precision highp float;precision highp int;
uniform highp sampler2D uDepth;uniform mat4 uInv;uniform vec3 uCam;uniform vec2 uViewport;uniform float uWall,uDoorIn,uDoorOut;uniform vec2 uOut;
${HASH_GLSL}
float h3(ivec3 q){return rnd(uint(q.x+70000)*73856093u^uint(q.y+70000)*19349663u^uint(q.z+70000)*83492791u);}
float noise3(vec3 x){ivec3 i=ivec3(floor(x));vec3 f=fract(x);f=f*f*(3.-2.*f);
 return mix(mix(mix(h3(i),h3(i+ivec3(1,0,0)),f.x),mix(h3(i+ivec3(0,1,0)),h3(i+ivec3(1,1,0)),f.x),f.y),
            mix(mix(h3(i+ivec3(0,0,1)),h3(i+ivec3(1,0,1)),f.x),mix(h3(i+ivec3(0,1,1)),h3(i+ivec3(1,1,1)),f.x),f.y),f.z);}
struct Px{float d;vec3 p;vec3 dir;float dist;bool outside;float k;};
// k = how much "outside" a pixel is: 0 deep in the hangar, rising smoothly across the doorway, 1 out on the street (no hard line)
Px look(){Px r;r.d=texelFetch(uDepth,ivec2(gl_FragCoord.xy),0).r;vec2 n=gl_FragCoord.xy/uViewport*2.-1.;
 vec4 w=uInv*vec4(n,r.d*2.-1.,1.);r.p=w.xyz/w.w;
 vec4 a=uInv*vec4(n,-1.,1.),b=uInv*vec4(n,1.,1.);r.dir=normalize(b.xyz/b.w-a.xyz/a.w);
 r.dist=r.d>=.99999?1e9:distance(r.p,uCam);
 float s=dot(r.p.xy,uOut);
 r.outside=r.d>=.99999||s>uWall+5.;
 r.k=r.d>=.99999?1.:smoothstep(uWall-uDoorIn,uWall+uDoorOut,s);return r;}
// one star field for the whole sky (owner 2026-11-21: more stars, more glow): a star in about 6 % of the cells (1/260 rad), a sharp
// core and a soft halo; the 3 x 3 cells round the pixel are read so a halo is never cut at a cell's edge
float starAt(vec3 dir,float t){vec2 sp=vec2(atan(dir.y,dir.x)*260.,dir.z*260.);vec2 c0=floor(sp);float sum=0.;
 for(int j=-1;j<=1;j++)for(int i=-1;i<=1;i++){vec2 c=c0+vec2(float(i),float(j));
  uint k=uint(int(c.x)+70000)*73856093u^uint(int(c.y)+70000)*19349663u;
  if(rnd(k)<=.94)continue;
  vec2 ctr=c+.5+.35*(vec2(rnd(k+1u),rnd(k+2u))-.5);float r=length(sp-ctr);
  float tw=.6+.4*sin(t*(1.5+rnd(k+3u)*3.)+rnd(k+4u)*6.28);
  sum+=tw*(exp(-r*r*30.)*1.5+exp(-r*r*4.)*.35)*(.4+.6*rnd(k+5u));}
 return sum;}
`;
    const GRADE_FS = `#version 300 es
${DEPTH_GLSL}
uniform vec3 uIn,uHor,uZen;out vec4 o;
void main(){Px x=look();vec3 out_=mix(uHor,uZen,smoothstep(-.02,.35,x.dir.z));o=vec4(mix(uIn,out_,x.k),1.);}`;
    const ATMOS_FS = `#version 300 es
${DEPTH_GLSL}
uniform float uTime,uStars,uFog,uFogStart,uFogHeight,uFogMove,uCover,uGlow,uGroundZ,uSkyZ,uSkyNear,uSkyLow,uZones,uCloud,uCloudK,uCloudSpeed,uFlash,uBolt,uSpark;
uniform vec3 uFogCol,uSunDir,uSunCol,uCoverCol,uCloudCol,uFlashCol;uniform float uCoverThick;uniform vec2 uLatD;uniform sampler2D uBoltTex;out vec4 o;
vec3 posAt(ivec2 q){q=clamp(q,ivec2(0),ivec2(uViewport)-1);float d=texelFetch(uDepth,q,0).r;vec2 n=(vec2(q)+.5)/uViewport*2.-1.;vec4 w=uInv*vec4(n,d*2.-1.,1.);return w.xyz/w.w;}
void main(){
 Px x=look();
 bool sky=x.outside&&(x.d>=.99999||x.p.z>uSkyZ||(dot(x.p.xy,uOut)>uSkyNear-60.&&x.p.z>uSkyLow));
 vec4 acc=vec4(0.);
 // v1.49: the old snow pattern, but near the door the pattern itself is lowered BEFORE it is turned into patches (not the patches faded
 // or cut after): a patch near the entrance narrows and ends with its own soft ragged edge like everywhere else, never a straight cut.
 // At the door line (uWall + 5) the lowering is more than the pattern can ever reach, so no snow touches the entrance; it eases off over
 // 300 units, about as slowly as the pattern itself changes, so the patch edges there stay wavy, not lined up with the door.
 // Owner fix 2026-11-22 (jagged steps on the sidewalk's ends in the snowy looks): the surface's facing is found per pixel from its four
 // neighbours (on each axis the one on the same surface, the smaller jump), not from the 2 x 2 block derivatives that mixed two surfaces
 // at an edge; snow fades in over a slope range (.65 to .8) instead of a hard cut at .7; and on a real edge (a neighbour far off in
 // depth) it is halved, as the game's own smoothed edges.
 if(uCover>0.&&!sky&&x.d<.99999){
  ivec2 q=ivec2(gl_FragCoord.xy);
  vec3 pl=posAt(q-ivec2(1,0)),pr=posAt(q+ivec2(1,0)),pd=posAt(q-ivec2(0,1)),pu=posAt(q+ivec2(0,1));
  float el=distance(x.p,pl),er=distance(pr,x.p),ed=distance(x.p,pd),eu=distance(pu,x.p);
  // at the picture's edge the clamped neighbour is the pixel itself (0): the other side is used
  if(el<=0.)el=er;if(er<=0.)er=el;if(ed<=0.)ed=eu;if(eu<=0.)eu=ed;
  vec3 n=cross(er<el||x.p==pl?pr-x.p:x.p-pl,eu<ed||x.p==pd?pu-x.p:x.p-pd);
  float flat_=abs(n.z)/max(length(n),.00001);
  float edge=smoothstep(2.,6.,max(max(el,er)/max(min(el,er),.001),max(ed,eu)/max(min(ed,eu),.001)));
  float ramp=smoothstep(.65,.8,flat_)*(1.-.5*edge);
  if(ramp>0.){
  float nn=noise3(vec3(x.p.xy/180.,0.))*.65+noise3(vec3(x.p.xy/45.,3.))*.35;
  float push=1.6*(1.-smoothstep(uWall+5.,uWall+305.,dot(x.p.xy,uOut)));
  float c=smoothstep(1.-uCover,1.-uCover+.18,nn*(.75+.25*flat_)+uCover*.35-push)*(1.-smoothstep(4000.,9000.,x.dist))*.92;
  c=min(1.,c*uCoverThick)*ramp;acc=vec4(uCoverCol*c,c);
  if(uSpark>0.&&c>.25){vec2 cl=floor(x.p.xy/22.);uint kk=uint(int(cl.x)+70000)*73856093u^uint(int(cl.y)+70000)*19349663u;
   float tw=pow(max(0.,sin(uTime*(1.2+rnd(kk+1u)*3.)+rnd(kk+2u)*6.28)),10.);
   acc.rgb+=vec3(1.,.98,.92)*step(.965,rnd(kk))*tw*uSpark*c*(1.-smoothstep(2000.,7000.,x.dist));}}}
 // fogF = how much fog covers this pixel; the stars below shine only through what it leaves (owner 2026-11-21: on the foggy night the
 // stars, added after the fog, made the upper sky look clear)
 float fogF=0.;
 if(uFog>0.&&x.k>.001){
  float hz=sky?.25:exp(-max(x.p.z-uGroundZ,0.)/max(uFogHeight,1.));
  float mv=noise3(vec3(x.p.xy*.0005+vec2(uTime*uFogMove*.03,0.),x.p.z*.0008+uTime*uFogMove*.01));
  float f=sky?min(1.,uFog*.85):1.-exp(-max(x.dist-uFogStart,0.)*uFog*.00045*mix(.35,1.,hz)*mix(.55,1.45,mv));
  f*=x.k;fogF=f;
  acc=vec4(uFogCol*f,f)+acc*(1.-f);}
 // the sun's glare is seen by the camera over the whole picture (a lens glow), so it does not stop at the doorway; the sun's disc only in the sky
 float s=max(dot(x.dir,uSunDir),0.);
 acc.rgb+=uSunCol*uGlow*((sky?pow(s,900.)*2.5:0.)+(pow(s,60.)*.35+pow(s,8.)*.12)*mix(.55,1.,x.k));
 if(uStars>0.&&sky)acc.rgb+=vec3(.9,.95,1.)*uStars*starAt(x.dir,uTime)*(1.-fogF);
 // the overcast sky: grey cloud over the blue sky (a flat cloud layer seen from below, drifting; lighter toward the horizon)
 if(uCloud>0.&&sky){
  vec2 q=x.dir.xy/(max(x.dir.z,0.)+.32)*.9+vec2(uTime*uCloudSpeed*.02,0.);
  float cn=noise3(vec3(q*1.6,0.))*.55+noise3(vec3(q*3.4,7.))*.3+noise3(vec3(q*7.,3.))*.15;
  vec3 cc=uCloudCol*mix(1.,.55+.9*cn,uCloudK)*mix(1.15,.85,smoothstep(0.,.9,x.dir.z));
  acc=vec4(cc*uCloud,uCloud)+acc*(1.-uCloud);}
 // lightning: the whole picture lit by the flash (the sky most, the street a lot, the hangar a little), and the bolt drawn in the sky by direction
 if(uFlash>0.){
  acc.rgb+=uFlashCol*uFlash*(sky?.45:mix(.5,.8,x.k));
 }
 if(uZones>0.){vec3 z=sky?vec3(0.,0.,1.):mix(vec3(0.,1.,0.),vec3(1.,0.,0.),x.k);acc=vec4(z*.35,.35)+acc*.65;}
 o=acc;}`;
    const MESH_VS = `#version 300 es
precision highp float;
in vec3 aP;in vec2 aT;uniform mat4 uVP;uniform vec3 uOff,uXt;uniform vec4 uXr;uniform float uXs;out vec2 vT;
void main(){vT=aT;vec3 p=vec3(mat2(uXr.x,uXr.y,uXr.z,uXr.w)*aP.xy*uXs,aP.z*uXs)+uXt;gl_Position=uVP*vec4(p+uOff,1.);}`;
    const MESH_FS = `#version 300 es
precision highp float;
in vec2 vT;uniform sampler2D uTex;uniform int uMode;uniform float uBright,uAmt,uAlpha;out vec4 o;
void main(){vec4 c=texture(uTex,vT);
 if(uMode==0){o=vec4(c.rgb*uBright,uAlpha);return;}
 if(uMode==1){if(c.a<.5)discard;o=vec4(c.rgb*uBright,uAlpha);return;}
 if(uMode==2){o=vec4(c.rgb*uBright*c.a*uAlpha,c.a*uAlpha);return;}
 if(uMode==4){float e=smoothstep(.62,.85,c.g)*smoothstep(.8,.95,c.r)*(1.-smoothstep(.35,.55,c.b));o=vec4(vec3(1.,.62,.2)*e*uAmt,0.);return;}
 o=vec4(mix(vec3(1.),c.rgb,uAmt),1.);}`;
    const LAMP_FS = `#version 300 es
${DEPTH_GLSL}
uniform vec3 uLamp[8];uniform int uN,uMode;uniform float uPower,uReach,uGlow;uniform vec3 uCol;uniform mat4 uVP;out vec4 o;
void main(){
 if(uMode==0){
  Px x=look();if(x.d>=.99999)discard;
  vec3 n=cross(dFdx(x.p),dFdy(x.p));float ln=length(n);n=ln>0.?n/ln:vec3(0.,0.,1.);if(dot(n,uCam-x.p)<0.)n=-n;
  float L=0.;
  for(int i=0;i<8;i++){if(i>=uN)break;vec3 d=uLamp[i]-x.p;float dist=length(d);vec3 l=d/max(dist,1.);
   float cone=smoothstep(.05,.6,l.z);
   float fall=1./(1.+dist*dist/(uReach*uReach))*(1.-smoothstep(uReach*2.,uReach*4.,dist));
   L+=cone*fall*(.35+.65*max(dot(n,l),0.));}
  o=vec4(uCol*(L*uPower*(1.-x.k)),1.);return;}
 vec3 acc=vec3(0.);
 for(int i=0;i<8;i++){if(i>=uN)break;vec4 c=uVP*vec4(uLamp[i],1.);if(c.w<=1.)continue;vec3 s=c.xyz/c.w;if(abs(s.x)>1.3||abs(s.y)>1.3)continue;
  vec2 px=(s.xy*.5+.5)*uViewport;ivec2 ip=ivec2(clamp(px,vec2(0.),uViewport-1.));
  float vis=(s.z*.5+.5)<=texelFetch(uDepth,ip,0).r+.0004?1.:0.;
  float r=distance(gl_FragCoord.xy,px)/max(2.,uViewport.y*45./c.w);
  acc+=uCol*vis*(exp(-r*r*3.)*1.2+exp(-r*1.6)*.22);}
 o=vec4(acc*uGlow,0.);}`;
    // 26d step 9: the rotating warning beacon while the game searches (ours, not a probe's), multiplied like the lamps' light: its
    // turning beam, a narrow wedge sweeping the ground and the walls round it, reaching far, plus its faint glow all round, nearer.
    const SIREN_FS = `#version 300 es
${DEPTH_GLSL}
uniform vec3 uLamp[8];uniform vec3 uRot[8];uniform vec3 uStb[8];uniform vec2 uDir[8];uniform int uN;
uniform float uReach,uBeamReach,uBeam;out vec4 o;
void main(){
 Px x=look();if(x.d>=.99999)discard;
 vec3 n=cross(dFdx(x.p),dFdy(x.p));float ln=length(n);n=ln>0.?n/ln:vec3(0.,0.,1.);if(dot(n,uCam-x.p)<0.)n=-n;
 vec3 L=vec3(0.);
 for(int i=0;i<8;i++){if(i>=uN)break;vec3 d=uLamp[i]-x.p;float dist=length(d);vec3 l=d/max(dist,1.);
  float face=.3+.7*max(dot(n,l),0.);
  float nr=1./(1.+dist*dist/(uReach*uReach));
  float fr=1./(1.+dist*dist/(uBeamReach*uBeamReach));
  vec2 h=x.p.xy-uLamp[i].xy;float hl=length(h);
  float beam=hl>1.?pow(max(dot(h/hl,uDir[i]),0.),uBeam)*smoothstep(20.,140.,hl):0.;
  L+=(uRot[i]*(beam*fr)+uStb[i]*nr)*face;}
 o=vec4(L*(1.-x.k),1.);}`;
    // 26d step 10: the waiting room, the launch lift. Every pixel that is not the tank (a cylinder round the tank base over the floor,
    // from the game's depth) or the drone (a ball round it) shows, as far as the room has faded in, what the pixel's own line of
    // sight from the camera meets first in our lift: the tall square shaft (along the hangar's two ways, uW from the tank each way),
    // the lift's floor filling it from wall to wall 320 under the tank, and on it the tank's stand (uDeck from the tank each way, 40
    // deep) on four steel legs round a hydraulic ram, military steel stairs from the stand down to the floor on its side to the
    // screen's right, going down towards the player (a landing, seven grating treads with yellow edges, side plates, yellow rails),
    // and a supply crate stack in each corner. The stand: tread plate, a hazard
    // border, a ring with amber lights, the tank's soft shadow, a red light strip on its sides. The floor: grating, hazard stripes
    // along the walls, the stand's shadow. The crates: olive, framed, each corner its own white symbol (a cross, a shield, a double
    // arrow, a lightning bolt). The walls: olive steel panels with rivets, grime streaks, rust, scorch marks, bullet dents, two
    // pipes, and on the wall behind the tank only (where the line from the camera through the tank meets it) the Tanki logo (uLogo,
    // its shape painted in bone white) in a ring with three chevrons beside (every 3200, between two girders), a girder every 800
    // (warning stripes on every other one), two guide rails, a row of work lamps under each
    // girder (every fourth a red warning lamp) lighting the walls round them, darker corners; all sliding down by uRise (the lift
    // rising). A dark pit below, the bright way out far above, the beacon's beam on everything; the lift brighter by uRow (a lamp row
    // near).
    const ROOM_FS = `#version 300 es
${DEPTH_GLSL}
uniform vec3 uBase,uBeamCol;uniform vec2 uBeamDir;uniform vec4 uDrone;uniform float uR,uFloor,uTop,uSoft,uAmt,uW,uRise,uRow,uDeck,uHasLogo;
uniform highp sampler2D uLogo;out vec4 o;
const float FD=320.;const vec3 INK=vec3(.8,.76,.62);
// the stairs: SR up each step, SG along, SW wide, their first tread SS along the stand's side (their landing just before)
// (owner 2026-11-24: the landing at the far end of the stand's side, so SS = -460 + SW; the stand is 460 each way)
const float SR=40.,SG=58.,SW=170.,SS=-290.;
// world units a pixel covers where the ray hits (for the logo's sharpness)
float gPx=1.;
float hs(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float vn(vec2 p){vec2 i=floor(p);vec2 f=fract(p);f=f*f*(3.-2.*f);
 return mix(mix(hs(i),hs(i+vec2(1.,0.)),f.x),mix(hs(i+vec2(0.,1.)),hs(i+vec2(1.,1.)),f.x),f.y);}
// the Tanki logo's paint (0..1) at q from its middle (y up), hh = half its height; the picture is 400 x 388
float logo(vec2 q,float hh){
 if(uHasLogo<.5)return 0.;
 vec2 uv=vec2(q.x/(hh*2.0619)+.5,.5-q.y/(hh*2.));
 if(uv.x<0.||uv.x>1.||uv.y<0.||uv.y>1.)return 0.;
 return textureLod(uLogo,uv,log2(max(194./hh*gPx,1.))).a;}
// a capsule (a hand rail) from pa to pb, r thick (worked in hundredths so the numbers stay small)
float cap(vec3 ro,vec3 rd,vec3 pa,vec3 pb,float r,out vec3 nr){
 const float K=.01;vec3 ba=(pb-pa)*K;vec3 oa=(ro-pa)*K;r*=K;nr=vec3(0.,0.,1.);
 float baba=dot(ba,ba),bard=dot(ba,rd),baoa=dot(ba,oa),rdoa=dot(rd,oa),oaoa=dot(oa,oa);
 float aa=baba-bard*bard,bb=baba*rdoa-baoa*bard,cc=baba*oaoa-baoa*baoa-r*r*baba,h=bb*bb-aa*cc;
 if(h<0.||aa<1e-7)return 1e9;
 float t=(-bb-sqrt(h))/aa;float y=baoa+t*bard;
 if(y<0.||y>baba){vec3 oc=y<=0.?oa:oa-ba;bb=dot(rd,oc);cc=dot(oc,oc)-r*r;h=bb*bb-cc;if(h<0.)return 1e9;t=-bb-sqrt(h);}
 if(t<=0.)return 1e9;
 vec3 p=oa+rd*t;nr=normalize(p-ba*clamp(dot(p,ba)/baba,0.,1.));return t/K;}
float box(vec3 ro,vec3 rd,vec3 lo,vec3 hi,out vec3 nr){
 vec3 r2=mix(rd,vec3(1e-6),step(abs(rd),vec3(1e-6)));
 vec3 t0=(lo-ro)/r2;vec3 t1=(hi-ro)/r2;vec3 tn=min(t0,t1);vec3 tf=max(t0,t1);
 float a=max(max(tn.x,tn.y),tn.z);float b=min(min(tf.x,tf.y),tf.z);
 nr=vec3(0.,0.,1.);if(b<a||a<=0.)return 1e9;
 nr=a==tn.x?vec3(-sign(rd.x),0.,0.):a==tn.y?vec3(0.,-sign(rd.y),0.):vec3(0.,0.,-sign(rd.z));return a;}
float cyl(vec3 ro,vec3 rd,vec2 c,float r,float z0,float z1,out vec3 nr){
 vec2 oc=ro.xy-c;float a=dot(rd.xy,rd.xy);float b=dot(oc,rd.xy);float cc=dot(oc,oc)-r*r;float h=b*b-a*cc;
 nr=vec3(0.,0.,1.);if(a<1e-8||h<0.)return 1e9;
 float t=(-b-sqrt(h))/a;if(t<=0.)return 1e9;
 float z=ro.z+rd.z*t;if(z<z0||z>z1)return 1e9;
 nr=vec3((oc+rd.xy*t)/r,0.);return t;}
float hazard(float s){return step(.5,fract(s/90.));}
vec3 stripes(float s){return mix(vec3(.02),vec3(.85,.62,.05)*.6,hazard(s));}
vec3 wall(float u,float v,float side,float back){
 vec2 q=vec2(u/300.,v/400.);vec2 cell=floor(q);vec2 f=fract(q);
 float pan=.6+.3*hs(cell+side*17.);
 float seam=smoothstep(0.,.012,f.x)*smoothstep(0.,.012,1.-f.x)*smoothstep(0.,.01,f.y)*smoothstep(0.,.01,1.-f.y);
 vec3 col=vec3(.085,.1,.085)*pan*(.55+.45*seam);
 vec2 rc=(f-.5)*vec2(300.,400.);
 col+=(1.-smoothstep(5.,8.,length(abs(rc)-vec2(135.,185.))))*.035;
 float gr=vn(vec2(u/70.,v/900.)+side*7.);float sc=vn(vec2(u/520.,v/520.)+side*3.);
 col*=.65+.45*gr;
 col=mix(col,vec3(.13,.07,.03)*.8,smoothstep(.7,.95,gr)*.5);
 col*=1.-.6*smoothstep(.62,.85,sc);
 vec2 dc=floor(vec2(u,v)/120.);vec2 dp=vec2(u,v)-dc*120.-60.-(vec2(hs(dc+3.1),hs(dc+7.7))-.5)*70.;
 float dent=step(hs(dc+side)*1.,.07)*(1.-smoothstep(5.,8.,length(dp)));
 col=mix(col,vec3(.015),dent);
 float pu=abs(abs(u)-uW*.78);float pipe=1.-smoothstep(26.,30.,pu);
 col=mix(col,vec3(.07,.08,.07)*(.45+.9*sqrt(max(0.,1.-pu*pu/900.))),pipe);
 if(side==back){
  float k=floor(v/3200.);float ev=v-3200.*k-432.;
  vec2 ep=vec2(u-(mod(side,2.)<1.?-uW*.32:uW*.32),ev);
  float ring=abs(length(ep)-250.)-14.;
  vec2 cp=vec2(ep.x-430.,ep.y);float chev=1e9;
  for(int i=0;i<3;i++){vec2 c=vec2(abs(cp.x),cp.y+float(i-1)*80.);chev=min(chev,max(abs(c.y-c.x*.55)-16.,c.x-110.));}
  float paint=max(1.-smoothstep(-2.,2.,min(ring,chev)),logo(ep,170.));
  col=mix(col,INK*(.55+.45*gr),paint*.55);}
 float g=fract(v/800.);float band=smoothstep(0.,.01,g)*(1.-smoothstep(.07,.08,g));
 col=mix(col,vec3(.14,.15,.14)*(1.-.5*smoothstep(0.,.075,g)),band);
 if(mod(floor(v/800.),2.)<1.)col=mix(col,stripes(u+v),band);
 float rail=1.-smoothstep(18.,26.,abs(abs(u)-uW*.55));col=mix(col,vec3(.045,.05,.045),rail);
 col*=.45+.55*smoothstep(0.,uW*.35,uW-abs(u));
 float lv=v-740.-floor((v-740.)/800.+.5)*800.;
 float li=floor(u/260.+.5);float lu=u-li*260.;
 float lamp=exp(-(lu*lu+lv*lv*4.)/180.);
 float wash=exp(-lv*lv/(260.*260.));
 vec3 lc=mod(li,4.)<1.?vec3(1.,.08,.04)*2.6:vec3(1.,.85,.6)*2.2;
 return col*(.35+1.1*wash)+lc*lamp;}
vec3 stand(vec3 p,vec3 nr){
 vec3 col;
 if(nr.z>.5){
  float r=length(p.xy);
  vec2 dq=fract(vec2(p.x+p.y,p.x-p.y)/46.)-.5;
  col=vec3(.12,.125,.12)*(.85+.25*smoothstep(.2,.08,abs(dq.x)+abs(dq.y)));
  col*=.75+.35*vn(p.xy/90.);
  float e=uDeck-max(abs(p.x),abs(p.y));
  col=mix(col,stripes(p.x+p.y),smoothstep(0.,3.,e)*(1.-smoothstep(50.,54.,e)));
  float seg=step(.35,fract(atan(p.y,p.x)/6.2831853*32.));
  col+=vec3(1.,.55,.08)*(1.-smoothstep(6.,10.,abs(r-uDeck+85.)))*seg*1.4;
  col*=mix(.3,1.,smoothstep(160.,uDeck-40.,r));
 } else {
  float s=abs(nr.x)>.5?p.y:p.x;
  col=vec3(.06,.065,.06)*(.8+.3*step(.5,fract(s/40.)));
  col+=vec3(1.,.06,.03)*(1.-smoothstep(3.,6.,abs(p.z+20.)))*1.8;
 }
 return col;}
// a tread or the landing of the stairs: steel grating, a yellow edge where it steps down (l = along the stand's side)
vec3 tread(vec3 p,vec3 nr,float l){
 vec2 g=abs(fract(p.xy/22.)-.5);
 vec3 c=vec3(.1,.105,.1)*(.55+.45*smoothstep(.3,.4,max(g.x,g.y)));
 float nose=nr.z<.5?1.:l>SS?smoothstep(.8,.83,fract((l-SS)/SG)):smoothstep(-22.,-19.,l-SS);
 return mix(c,vec3(.85,.62,.05)*.7,nose);}
// a box of the stairs from l0 to l1 along the stand's side (st), n0 to n1 out from it (sn), z0 to z1 high
float sbox(vec3 ro,vec3 rd,vec2 st,vec2 sn,vec4 ln,vec2 z,out vec3 nr){
 vec2 c0=st*ln.x+sn*(uDeck+ln.z);vec2 c1=st*ln.y+sn*(uDeck+ln.w);
 return box(ro,rd,vec3(min(c0,c1),z.x),vec3(max(c0,c1),z.y),nr);}
vec3 floorCol(vec3 p){
 vec2 g=abs(fract(p.xy/60.)-.5);
 vec3 col=vec3(.07,.075,.07)*(.6+.4*smoothstep(.42,.46,max(g.x,g.y)));
 col*=.8+.3*vn(p.xy/150.);
 float e=uW-max(abs(p.x),abs(p.y));
 col=mix(col,stripes(p.x+p.y),1.-smoothstep(80.,84.,e));
 float sh=max(abs(p.x),abs(p.y))-uDeck;
 col*=mix(.25,1.,smoothstep(-40.,140.,sh));
 return col;}
vec3 crate(vec3 p,vec3 nr,vec3 c,vec3 hb,float kind){
 vec3 q=p-c;
 vec2 uv=abs(nr.z)>.5?q.xy:(abs(nr.x)>.5?q.yz:q.xz);
 vec2 hsz=abs(nr.z)>.5?hb.xy:(abs(nr.x)>.5?hb.yz:hb.xz);
 vec2 e=hsz-abs(uv);
 vec3 col=vec3(.16,.18,.1)*(.8+.3*vn(p.xy/40.+p.z/40.));
 col=mix(col,vec3(.07,.08,.05),1.-smoothstep(10.,13.,min(e.x,e.y)));
 if(abs(nr.z)<.5){
  vec2 s=uv/min(hsz.x,hsz.y);float d;
  if(kind<.5)d=min(max(abs(s.x)-.45,abs(s.y)-.13),max(abs(s.x)-.13,abs(s.y)-.45));
  else if(kind<1.5)d=max(length(vec2(s.x,max(s.y,0.)))-.42,max(abs(s.x)+max(-s.y,0.)*.9-.42,-s.y-.5));
  else if(kind<2.5){vec2 a=vec2(abs(s.x),s.y);d=min(max(abs(a.y-.15-(.4-a.x)*.9)-.08,a.x-.4),max(abs(a.y+.25-(.4-a.x)*.9)-.08,a.x-.4));}
  else{d=max(abs(s.x+s.y*.35-(s.y>0.?.1:-.1))-.1,abs(s.y)-.5);}
  col=mix(col,vec3(.8,.8,.72),1.-smoothstep(-.02,.02,d));}
 return col;}
void main(){
 Px x=look();
 float keep=0.;
 if(x.d<.99999){
  float r=length(x.p.xy-uBase.xy);
  keep=(1.-smoothstep(uR-uSoft,uR,r))*smoothstep(uFloor,uFloor+uSoft*.4,x.p.z)*(1.-smoothstep(uTop-uSoft,uTop,x.p.z));
  if(uDrone.w>0.)keep=max(keep,1.-smoothstep(uDrone.w-20.,uDrone.w,distance(x.p,uDrone.xyz)));}
 float a=uAmt*(1.-keep);
 if(a<.002)discard;
 vec2 ax=normalize(uOut);vec2 ay=vec2(-ax.y,ax.x);
 vec3 ro=vec3(dot(uCam.xy-uBase.xy,ax),dot(uCam.xy-uBase.xy,ay),uCam.z-uBase.z);
 vec3 rd=vec3(dot(x.dir.xy,ax),dot(x.dir.xy,ay),x.dir.z);
 vec3 L=normalize(vec3(normalize(ro.xy+vec2(.001))*.5,1.));
 float tx=abs(rd.x)>1e-5?((rd.x>0.?uW:-uW)-ro.x)/rd.x:1e9;
 float ty=abs(rd.y)>1e-5?((rd.y>0.?uW:-uW)-ro.y)/rd.y:1e9;
 float t=max(min(tx,ty),0.);int what=0;vec3 nr=vec3(0.,0.,1.);
 if(rd.z<0.){float tf=(-FD-ro.z)/rd.z;if(tf>0.&&tf<t){t=tf;what=1;nr=vec3(0.,0.,1.);}}
 vec3 n4;float t4;
 t4=box(ro,rd,vec3(-uDeck,-uDeck,-40.),vec3(uDeck,uDeck,0.),n4);if(t4<t){t=t4;what=2;nr=n4;}
 t4=cyl(ro,rd,vec2(0.),95.,-FD,-40.,n4);if(t4<t){t=t4;what=3;nr=n4;}
 for(int i=0;i<4;i++){vec2 c=vec2(i<2?1.:-1.,mod(float(i),2.)<1.?1.:-1.)*(uDeck-70.);
  t4=cyl(ro,rd,c,34.,-FD,-40.,n4);if(t4<t){t=t4;what=4;nr=n4;}}
 // the stairs (owner 2026-11-24, drawn on his screenshot), on the stand's side to the screen's right (sn out of it, from the camera),
 // going down along it towards the player (st): a landing at the stand's top, seven treads, two side plates, yellow hand rails (high
 // and middle) on the outer side and at the landing's end, on posts
 vec4 ra=uInv*vec4(1.,0.,0.,1.),rb=uInv*vec4(-1.,0.,0.,1.);vec3 rw=ra.xyz/ra.w-rb.xyz/rb.w;
 vec2 st=abs(ro.x)>abs(ro.y)?vec2(sign(ro.x),0.):vec2(0.,sign(ro.y));
 vec2 sn=vec2(-st.y,st.x);if(dot(sn,vec2(dot(rw.xy,ax),dot(rw.xy,ay)))<0.)sn=-sn;
 t4=sbox(ro,rd,st,sn,vec4(SS-SW,SS,0.,SW),vec2(-14.,0.),n4);if(t4<t){t=t4;what=6;nr=n4;}
 for(int i=0;i<7;i++){
  t4=sbox(ro,rd,st,sn,vec4(SS+float(i)*SG-3.,SS+float(i+1)*SG+3.,6.,SW-6.),vec2(-float(i+1)*SR-8.,-float(i+1)*SR),n4);
  if(t4<t){t=t4;what=6;nr=n4;}}
 float dn=dot(rd.xy,sn);
 if(abs(dn)>1e-5)for(int j=0;j<2;j++){
  float tp=(uDeck+(j==0?4.:SW)-dot(ro.xy,sn))/dn;
  if(tp>0.&&tp<t){vec3 pp=ro+rd*tp;float l=dot(pp.xy,st);float zl=-(l-SS)*SR/SG;
   if(l>SS+4.&&l<SS+7.6*SG&&pp.z<zl+10.&&pp.z>max(zl-80.,-FD)){t=tp;what=7;nr=vec3(-sign(dn)*sn,0.);}}}
 vec3 rA=vec3(st*SS+sn*(uDeck+SW-8.),0.);vec3 rB=vec3(st*(SS+7.*SG)+sn*(uDeck+SW-8.),-7.*SR);
 vec3 rC=vec3(st*(SS-SW+8.)+sn*(uDeck+SW-8.),0.);vec3 rD=vec3(st*(SS-SW+8.)+sn*(uDeck+8.),0.);
 for(int j=0;j<2;j++){vec3 h=vec3(0.,0.,j==0?95.:50.);
  t4=cap(ro,rd,rA+h,rB+h,5.,n4);if(t4<t){t=t4;what=8;nr=n4;}
  t4=cap(ro,rd,rC+h,rA+h,5.,n4);if(t4<t){t=t4;what=8;nr=n4;}
  t4=cap(ro,rd,rD+h,rC+h,5.,n4);if(t4<t){t=t4;what=8;nr=n4;}}
 for(int j=0;j<5;j++){vec3 b=j==0?rD:j==1?rC:j==2?rA:j==3?mix(rA,rB,.5):rB;
  t4=cyl(ro,rd,b.xy,6.,b.z,b.z+95.,n4);if(t4<t){t=t4;what=8;nr=n4;}}
 float kind=0.;vec3 cc=vec3(0.);vec3 ch=vec3(0.);
 for(int i=0;i<4;i++){vec2 s=vec2(i<2?1.:-1.,mod(float(i),2.)<1.?1.:-1.);
  vec3 c0=vec3(s*(uW-170.),-FD+75.);vec3 h0=vec3(110.,110.,75.);
  t4=box(ro,rd,c0-h0,c0+h0,n4);if(t4<t){t=t4;what=5;nr=n4;kind=float(i);cc=c0;ch=h0;}
  vec3 c1=vec3(s*(uW-190.)+s.yx*vec2(-25.,20.),-FD+150.+60.);vec3 h1=vec3(80.,80.,60.);
  t4=box(ro,rd,c1-h1,c1+h1,n4);if(t4<t){t=t4;what=5;nr=n4;kind=float(3-i);cc=c1;ch=h1;}}
 vec3 hp=ro+rd*t;vec3 col;
 gPx=t*1.2/uViewport.y;
 float lit=.45+.75*max(dot(nr,L),0.);
 if(what==0){
  bool onX=tx<ty;
  float u=onX?hp.y*sign(rd.x):-hp.x*sign(rd.y);
  float side=onX?(rd.x>0.?0.:2.):(rd.y>0.?1.:3.);
  // the wall behind the tank: the one the line from the camera through the tank meets (only it has the logo)
  vec2 fb=-ro.xy;float back=abs(fb.x)>abs(fb.y)?(fb.x>0.?0.:2.):(fb.y>0.?1.:3.);
  col=wall(u,hp.z+uRise,side,back);
  col=mix(col,vec3(0.),1.-smoothstep(-4500.,-600.,hp.z));
  col=mix(col,vec3(.75,.8,.85),smoothstep(3000.,14000.,hp.z));}
 else if(what==1)col=floorCol(hp)*(.6+.8*uRow);
 else if(what==2)col=stand(hp,nr)*(.6+.8*uRow);
 else if(what==3){float band=step(.5,fract((hp.z+FD)/120.));col=mix(vec3(.5,.52,.55),vec3(.2,.21,.22),band*.6)*lit*(.6+.8*uRow);
  col+=vec3(.9)*pow(max(dot(reflect(rd,nr),L),0.),30.)*.4;}
 else if(what==4){col=vec3(.09,.1,.09)*lit;col=mix(col,stripes(hp.z*2.),step(hp.z,-FD+70.));col*=.6+.8*uRow;}
 else if(what==5)col=crate(hp,nr,cc,ch,kind)*lit*(.6+.8*uRow);
 else if(what==6)col=tread(hp,nr,dot(hp.xy,st))*lit*(.6+.8*uRow);
 else if(what==7)col=vec3(.07,.075,.07)*(.85+.3*step(.5,fract(dot(hp.xy,st)/60.)))*lit*(.6+.8*uRow);
 else{col=vec3(.8,.58,.06)*.75*lit*(.6+.8*uRow);col+=vec3(.9)*pow(max(dot(reflect(rd,nr),L),0.),24.)*.3;}
 vec2 bd=vec2(dot(uBeamDir,ax),dot(uBeamDir,ay));float hl=length(hp.xy);
 float bm=hl>1.?pow(max(dot(hp.xy/hl,bd),0.),10.)*exp(-abs(hp.z)/1800.):0.;
 col+=uBeamCol*bm*(col*3.+.05);
 o=vec4(col*a,a);}`;
    const MIX_VS = `#version 300 es
precision highp float;
in vec3 aP;in vec2 aT;uniform mat4 uVP;uniform vec3 uOff;out vec3 vW;
void main(){vW=aP+uOff;gl_Position=uVP*vec4(vW,1.);}`;
    const MIX_FS = `#version 300 es
precision highp float;
in vec3 vW;uniform sampler2D uMap;uniform vec2 uOut,uLat;uniform float uWall,uDepth,uAmt,uOutR,uFade,uInside;uniform vec4 uBox;uniform vec3 uTint,uTintIn,uLim;uniform float uTone;out vec4 o;
// uFade < 0: the first way (the copy stops at uOutR past the line). uFade >= 0 (the road, v1.29): inside it fades in by uAmt over uDepth; at the door it goes on to full cover (the floor strip outside the door is no floor at all), holds to uOutR past the line, then fades out over uFade into the game's own road
void main(){float s=dot(vW.xy,uOut);if(s>uWall+uOutR+max(uFade,0.))discard;float l=dot(vW.xy,uLat);
 float m=uWall+abs(uWall-s);vec2 uv=vec2((l-uBox.x)/(uBox.y-uBox.x),(m-uBox.z)/(uBox.w-uBox.z));
 vec4 g=texture(uMap,uv);float ain=clamp(uAmt*smoothstep(uWall-uDepth,uWall-10.,s),0.,1.);float a=uFade<0.?g.a*ain:g.a*mix(ain,1.,smoothstep(uWall,uWall+120.,s))*(1.-smoothstep(uWall+uOutR,uWall+uOutR+uFade,s));if(uLim.z>=0.)a*=smoothstep(uLim.x,uLim.x+uLim.z,l)*(1.-smoothstep(uLim.y-uLim.z,uLim.y,l));if(a<.003)discard;
 vec3 tn=mix(uTint,uTintIn,uTone*smoothstep(0.,1.,clamp((uWall-s)/uDepth,0.,1.)));
 tn*=mix(1.,uInside,smoothstep(uWall,uWall-250.,s));
 o=vec4(g.rgb*tn,a);}`;

    // ---- the 3ds reader and the triangle lists ----
    interface Group {
        readonly material: string;
        readonly faces: number[];
    }
    interface ModelObject {
        readonly name: string;
        v: Float32Array | null;
        f: Uint16Array | null;
        uv: Float32Array | null;
        readonly groups: Group[];
    }
    interface Material {
        name: string;
        texture: string | null;
        opacityMap: string | null;
    }
    // 26f4b: the night's lights out on the street (the probe's NIGHTX_VS / NIGHTX_FS, as text): mode 0 = the street lamps' posts (thin,
    // dark, facing the camera, fogged by their distance), mode 1 = the lamps' glow (a small bright core and a wide soft halo), mode 2 =
    // the red warning light far out (the same glow, blinking). All hidden behind buildings by the game's depth.
    const NIGHTX_VS = `#version 300 es
precision highp float;precision highp int;
uniform mat4 uVP;uniform vec3 uCam;uniform vec2 uOut,uLat;uniform int uMode;
uniform float uStart,uGap,uH,uGround,uSize,uRedSize;uniform vec2 uSides;uniform vec3 uRed;
out vec2 vQ;out float vDist;
void main(){
 int i=gl_InstanceID;vec3 p;
 if(uMode==2)p=uRed;
 else{float side=(i%2==0)?uSides.x:uSides.y;float sAt=uStart+float(i/2)*uGap+(i%2==1?uGap*.5:0.);
  p=vec3(uOut*sAt+uLat*side,uGround+(uMode==0?0.:uH));}
 vec2 q=vec2(float(gl_VertexID&1)*2.-1.,float(gl_VertexID>>1)*2.-1.);vQ=q;vDist=distance(uCam,p);
 vec3 to=uCam-p;
 if(uMode==0){vec3 r=normalize(vec3(-to.y,to.x,0.)+vec3(1e-4,0.,0.));
  gl_Position=uVP*vec4(p+r*q.x*8.+vec3(0.,0.,(q.y*.5+.5)*(uH+10.)),1.);return;}
 vec3 f=normalize(to),r=normalize(cross(vec3(0.,0.,1.),f)),u=cross(f,r);
 float sz=uMode==2?uRedSize:uSize;
 gl_Position=uVP*vec4(p+f*30.+(r*q.x+u*q.y)*sz,1.);}`;
    const NIGHTX_FS = `#version 300 es
precision highp float;precision highp int;
uniform int uMode;uniform vec3 uCol,uPostCol,uFogCol;uniform float uBright,uFog,uFogStart,uHalo;
in vec2 vQ;in float vDist;out vec4 o;
void main(){
 float fog=1.-exp(-max(vDist-uFogStart,0.)*uFog*.00045);
 if(uMode==0){o=vec4(mix(uPostCol,uFogCol,fog),1.);return;}
 float r=length(vQ);if(r>1.)discard;
 float core=exp(-r*r*180.)*(1.-fog*.75),halo=exp(-r*r*6.)*.22*uHalo*(.5+fog);
 vec3 c=uCol*uBright*(core*3.+halo);if(max(c.r,max(c.g,c.b))<.002)discard;
 o=vec4(c,0.);}`;
    // 26f4c: small living things at night (the probe's NCB_VS / NCB_FS, as text), hidden by the game's depth. Mode 0: fireflies, low
    // over the street outside the door, wandering slowly, each blinking now and then (a bright core and a soft glow, added). Mode 1:
    // moths fluttering round the four ring lamps (two flapping wings and a body, lit by the lamps).
    const NCB_VS = `#version 300 es
precision highp float;precision highp int;
uniform mat4 uVP;uniform vec3 uCam;uniform vec2 uOut,uLat,uSpan,uDist;uniform float uTime,uGround,uSize,uH,uSpeed,uSlow;uniform int uMode,uLampN;
uniform vec3 uLamp[8];
out vec2 vQ;out float vA;out float vSeed;
${HASH_GLSL}
void main(){
 uint id=uint(gl_InstanceID)*7u+(uMode==0?911u:1733u)+uint(uSlow*500.);
 float a=rnd(id),b=rnd(id+1u),c=rnd(id+2u),d=rnd(id+3u),e=rnd(id+4u);
 vec3 p;float sz;
 if(uMode==0){
  float t=uTime*uSpeed;
  float sOut=mix(uDist.x,uDist.y,a)+sin(t*.13+b*6.28)*120.+sin(t*.31+c*6.28)*50.;
  float lat=mix(uSpan.x,uSpan.y,b)+sin(t*.11+d*6.28)*160.+sin(t*.27+e*6.28)*60.;
  p=vec3(uOut*sOut+uLat*lat,uGround+mix(20.,uH,c)+sin(t*.4+a*6.28)*25.);
  float per=mix(2.5,6.,d),ph=fract(uTime/per+e);
  vA=mix(smoothstep(0.,.08,ph)*(1.-smoothstep(.15,.45,ph)),pow(.5+.5*sin(uTime*.45+e*6.28),2.),uSlow);
  sz=uSize*24.;
 }else{
  int L=gl_InstanceID%max(uLampN,1);vec3 lp=uLamp[L];
  float t=uTime*uSpeed*mix(.8,1.3,a);
  float ang=t*mix(2.,3.5,b)*(c<.5?-1.:1.)+d*6.28+sin(t*1.7+e*9.)*1.2;
  float r=mix(18.,55.,e)+sin(t*2.3+a*5.)*12.;
  p=lp+vec3(cos(ang)*r,sin(ang)*r,-25.+sin(t*1.9+b*7.)*18.+sin(t*5.1+c*3.)*6.);
  vA=1.;sz=uSize*mix(3.,4.5,a);
 }
 vSeed=a;
 vec2 q=vec2(float(gl_VertexID&1)*2.-1.,float(gl_VertexID>>1)*2.-1.);vQ=q;
 vec3 f=normalize(uCam-p),r=normalize(cross(vec3(0.,0.,1.),f)),u=cross(f,r);
 gl_Position=uVP*vec4(p+(r*q.x+u*q.y)*sz,1.);}`;
    const NCB_FS = `#version 300 es
precision highp float;precision highp int;
uniform int uMode;uniform vec3 uCol;uniform float uBright,uTime;
in vec2 vQ;in float vA;in float vSeed;out vec4 o;
void main(){
 if(uMode==0){float r=length(vQ);if(r>1.)discard;
  vec3 c=uCol*uBright*vA*(exp(-r*r*90.)*2.5+exp(-r*r*9.)*.22);
  if(max(c.r,max(c.g,c.b))<.003)discard;o=vec4(c,0.);return;}
 float flap=abs(sin(uTime*mix(28.,40.,vSeed)+vSeed*30.));
 vec2 q=vQ;float ax=abs(q.x);
 float wing=1.-smoothstep(.8,1.,length(vec2((ax-.45)/(.12+.4*flap),(q.y-.05)/.6)));
 float body=1.-smoothstep(.8,1.,length(vec2(q.x/.12,q.y/.55)));
 float a=max(wing*.85,body)*uBright;if(a<.02)discard;
 vec3 c=mix(vec3(.18,.14,.1),uCol,mix(.55,.8,wing));o=vec4(c*a,a);}`;
    // 26f4a: the clear night's extras (the probe's NCX_FS, as text). Mode 0 (multiplies, like light): the street lamps' light on the
    // street (26f4b). Mode 1 (added): lit windows in the town's buildings (a grid on each wall, some lit; not on trees or the painted
    // sky, told by the picture's own colour with the night colours taken out) and a shooting star (a bright head and a fading trail).
    const NCX_FS = `#version 300 es
${DEPTH_GLSL}
uniform sampler2D uPic;uniform float uHasPic,uTime,uGroundZ,uSkyZ,uSkyNear,uSkyLow;uniform vec2 uLat;uniform int uMode;uniform vec3 uHor,uZen;
uniform float uWnAmt,uWnDense,uWnSize,uWnNear,uWnFar,uWnChange;
uniform vec4 uMet;uniform float uMetT,uMetB,uMetLen,uMetW;
uniform float uPlAmt,uPlR,uPlStart,uPlGap,uPlH;uniform vec2 uPlSides;uniform int uPlN;uniform vec3 uPlCol;uniform float uStars;
out vec4 o;
// the 3D point under a pixel, read from the depth picture (no 2 x 2 block derivatives)
bool posAt(ivec2 c,out vec3 p){c=clamp(c,ivec2(0),ivec2(uViewport)-1);float d=texelFetch(uDepth,c,0).r;if(d>=.99999)return false;
 vec2 q=(vec2(c)+.5)/uViewport*2.-1.;vec4 w=uInv*vec4(q,d*2.-1.,1.);p=w.xyz/w.w;return true;}
// a wall for the lit windows (owner 2026-11-21: dashes on roof edges while the camera moved): the surface's direction worked out on
// each side of the pixel, 2 pixels away, from the depth picture; both must agree (the pixel lies well inside one flat surface) and
// stand upright. The 2 x 2 block derivatives changed with the camera's sub-pixel moves and mixed roof and wall at the edges.
bool wallAt(vec3 p0){ivec2 c=ivec2(gl_FragCoord.xy);vec3 pl,pr,pd,pu;
 if(!posAt(c-ivec2(2,0),pl)||!posAt(c+ivec2(2,0),pr)||!posAt(c-ivec2(0,2),pd)||!posAt(c+ivec2(0,2),pu))return false;
 vec3 n1=cross(p0-pl,pu-p0),n2=cross(pr-p0,p0-pd);float l1=length(n1),l2=length(n2);if(l1<=0.||l2<=0.)return false;
 n1/=l1;n2/=l2;if(dot(n1,n2)<.98)return false;
 return abs(normalize(n1+n2).z)<.3;}
void main(){
 Px x=look();
 float s=dot(x.p.xy,uOut);
 bool sky=x.outside&&(x.d>=.99999||x.p.z>uSkyZ||(s>uSkyNear-60.&&x.p.z>uSkyLow));
 vec3 g=mix(uHor,uZen,smoothstep(-.02,.35,x.dir.z));
 vec3 n=cross(dFdx(x.p),dFdy(x.p));float ln=length(n);n=ln>0.?n/ln:vec3(0.,0.,1.);if(dot(n,uCam-x.p)<0.)n=-n;
 if(uMode==0){
  if(sky||x.d>=.99999||x.k<.01)discard;
  float L=0.;
  for(int i=0;i<24;i++){if(i>=uPlN)break;
   float side=(i%2==0)?uPlSides.x:uPlSides.y;float sAt=uPlStart+float(i/2)*uPlGap+(i%2==1?uPlGap*.5:0.);
   vec3 lp=vec3(uOut*sAt+uLat*side,uGroundZ+uPlH);vec3 d=lp-x.p;if(d.z<5.)continue;
   float r=length(d.xy);L+=(max(dot(n,normalize(d)),0.)*.75+.25)*exp(-r*r/(uPlR*uPlR));}
  if(L<.002)discard;
  float gm=max(.06,(g.r+g.g+g.b)/3.);
  o=vec4(uPlCol*L*uPlAmt*x.k*.6/gm,1.);return;}
 vec3 acc=vec3(0.);
 vec3 c0=uHasPic>.5?texelFetch(uPic,ivec2(gl_FragCoord.xy),0).rgb/max(g,vec3(.02)):vec3(.5);
 // the painted sky behind the town: clearly sky-blue (a pale building with a blue tint is not), far out, as a 0 to 1 amount
 float skyBlue=uHasPic>.5?smoothstep(.16,.24,c0.b-c0.r)*step(.35,c0.b):0.;
 bool bluish=skyBlue>.01;
 float painted=x.outside&&!sky&&s>uSkyNear-60.?skyBlue:0.;
 if(uWnAmt>0.&&x.outside&&!sky&&x.d<.99999){
  float h=x.p.z-uGroundZ;
  if(s>uWall+uWnNear&&s<min(uWall+uWnFar,uSkyNear-60.)&&wallAt(x.p)&&h>100.&&!(uHasPic>.5&&(c0.g>max(c0.r,c0.b)*1.1||bluish))){
   // one coordinate along any wall facing the street or across it (no choice from the pixel's own normal, which is noisy far away)
   float u_=dot(x.p.xy,uLat+uOut);
   vec2 q=vec2(u_,h-100.)/(vec2(120.,140.)*uWnSize),c=floor(q),fq=fract(q);
   uint k=uint(int(c.x)+70000)*73856093u^uint(int(c.y)+70000)*19349663u;
   float per=mix(40.,150.,rnd(k+1u))/max(uWnChange,.05),T=uTime/per+rnd(k+2u),e=floor(T);
   float cur=step(rnd(k+uint(int(e)+1000)*7919u),uWnDense),prev=step(rnd(k+uint(int(e)+999)*7919u),uWnDense);
   float on=mix(prev,cur,smoothstep(0.,.4/per,fract(T)));
   if(on>.001){
    vec2 w=fwidth(q)+1e-4;
    float bx=smoothstep(.27-w.x,.27+w.x,fq.x)*(1.-smoothstep(.73-w.x,.73+w.x,fq.x));
    float by=smoothstep(.3-w.y,.3+w.y,fq.y)*(1.-smoothstep(.75-w.y,.75+w.y,fq.y));
    float win=mix(bx*by,.2,smoothstep(.25,.6,max(w.x,w.y)));
    float r3=rnd(k+3u);vec3 wc=r3<.6?vec3(1.,.7,.36):(r3<.88?vec3(1.,.86,.62):vec3(.62,.76,1.));
    float fl=r3>=.88?.8+.2*sin(uTime*(3.+rnd(k+4u)*5.)+rnd(k+5u)*20.):1.;
    acc+=wc*on*win*fl*mix(.55,1.,rnd(k+6u))*uWnAmt;}}}
 if(uStars>0.&&painted>.01)acc+=vec3(.9,.95,1.)*uStars*starAt(x.dir,uTime)*painted;
 if(uMetB>0.&&x.outside&&(sky||painted>.01)){
  vec2 P=vec2(atan(dot(x.dir.xy,uLat),dot(x.dir.xy,uOut)),asin(clamp(x.dir.z,-1.,1.)));
  vec2 d=P-uMet.xy,ab=uMet.zw-uMet.xy;float len=max(length(ab),1e-4);vec2 dv=ab/len;
  float along=dot(d,dv),across=abs(d.x*dv.y-d.y*dv.x),behind=uMetT*len-along,tl=max(uMetLen*len,1e-4);
  if(behind>-uMetW*4.&&behind<tl){
   float a=exp(-across*across/(uMetW*uMetW))*(behind<0.?exp(-behind*behind/(uMetW*uMetW)):pow(1.-behind/tl,2.)*(.35+.65*exp(-behind/(uMetW*6.))));
   acc+=vec3(.85,.92,1.)*a*uMetB*(sky?1.:painted);}}
 if(max(acc.r,max(acc.g,acc.b))<.002)discard;
 o=vec4(acc,0.);}`;
    // 26f3: the normal day's extras (the probe's CLOUDX_FS, LEAF_VS, LEAF_FS, as text)
    const CLOUDX_FS = `#version 300 es
${DEPTH_GLSL}
uniform float uTime,uAmt,uCover,uSize,uSpeed,uSkyZ,uSkyNear,uSkyLow,uHasPic;uniform vec3 uCol,uShade;uniform sampler2D uPic;out vec4 o;
void main(){
 Px x=look();
 bool sky=x.outside&&(x.d>=.99999||x.p.z>uSkyZ||(dot(x.p.xy,uOut)>uSkyNear-60.&&x.p.z>uSkyLow));
 float blue=1.;
 if(!sky&&uHasPic>.5&&x.outside&&x.dir.z>-.03&&dot(x.p.xy,uOut)>uWall+3000.){
  vec3 c=texelFetch(uPic,ivec2(gl_FragCoord.xy),0).rgb;
  blue=smoothstep(.04,.14,c.b-c.r)*smoothstep(.45,.6,c.b)*step(c.g,c.b+.02);
  sky=blue>.01;}
 if(!sky)discard;
 vec2 q=x.dir.xy/(max(x.dir.z,0.)+.25)*uSize*.9+vec2(uTime*uSpeed*.015,0.);
 float n=noise3(vec3(q*1.3,0.))*.55+noise3(vec3(q*2.9,5.))*.3+noise3(vec3(q*6.5,2.))*.15;
 float c=smoothstep(1.-uCover-.06,1.-uCover+.16,n);
 float a=c*uAmt*blue;
 if(a<.004)discard;
 vec3 col=mix(uShade,uCol,smoothstep(.4,.9,n));
 o=vec4(col*a,a);}`;
    const LEAF_VS = `#version 300 es
precision highp float;precision highp int;
uniform mat4 uVP;uniform vec3 uCam;uniform vec4 uP[64],uA[64],uB[64];uniform float uSize,uGround,uFloor,uWall;uniform vec2 uOut;uniform int uMode;
out vec2 vQ;out vec3 vN;out float vType;out float vHue;out float vH;out float vDist;
void main(){
 int i=gl_InstanceID;vec4 P=uP[i],A=uA[i],B=uB[i];
 int row=gl_VertexID>>1,col=gl_VertexID&1;
 vec2 q=vec2(float(row)*.5-1.,float(col)*2.-1.);vQ=q;
 float s=P.w*uSize*9.;vec3 a=A.xyz,b=B.xyz,n=normalize(cross(a,b));
 float gz=dot(P.xy,uOut)<uWall?uFloor:uGround;
 vType=A.w;vHue=B.w;vH=P.z-gz;
 if(uMode==1){
  vec3 af=vec3(a.xy,0.),bf=vec3(b.xy,0.);
  float la=max(length(af),.3),lb=max(length(bf),.3);
  af=normalize(af+vec3(1e-4,0.,0.))*la;bf=normalize(bf+vec3(0.,1e-4,0.))*lb;
  vec3 p=vec3(P.xy,gz+.8)+(af*q.x+bf*q.y)*s*.95;
  vDist=distance(uCam,p);vN=vec3(0.,0.,1.);gl_Position=uVP*vec4(p,1.);return;}
 float curl=(q.y*q.y*.22+q.x*q.x*.06)*s;
 vec3 p=P.xyz+(a*q.x+b*q.y)*s+n*curl+vec3(0.,0.,s*.1+1.5);
 vN=n;vDist=distance(uCam,p);gl_Position=uVP*vec4(p,1.);}`;
    const LEAF_FS = `#version 300 es
precision highp float;precision highp int;
uniform vec3 uLight,uSun;uniform int uMode;
in vec2 vQ;in vec3 vN;in float vType;in float vHue;in float vH;in float vDist;out vec4 o;
float hh(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float vn(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(hh(i),hh(i+vec2(1.,0.)),f.x),mix(hh(i+vec2(0.,1.)),hh(i+1.),f.x),f.y);}
float shape(vec2 q,int ty){
 float u=q.x,v=q.y;
 if(ty==2){vec2 p=vec2(u+.25,v);float r=length(p),th=atan(p.y,p.x);
  float R=.78*(.38+.62*pow(abs(cos(th*2.5)),1.6))*(1.-.25*smoothstep(2.3,3.1,abs(th)));
  return (R-r)*1.2;}
 float t=(u+.8)/1.75;if(t<0.||t>1.)return -1.;
 float w;
 if(ty==1){w=1.15*pow(t,.45)*pow(1.-t,.55);w*=.5+.5*pow(abs(sin(t*3.1416*4.5+.35)),.6);}
 else{w=1.25*pow(t,.55)*pow(1.-t,.85);w*=1.-.08*pow(abs(sin(t*48.)),3.);}
 return w*.95-abs(v);}
void main(){
 int ty=int(vType+.5);
 float d=shape(vQ,ty);
 float aw=fwidth(d)*1.2+1e-4;
 float stem=(1.-smoothstep(.025,.05,abs(vQ.y)))*step(vQ.x,-.62)*step(-1.,vQ.x)*(ty==2?step(vQ.x,-.85):1.);
 float a=max(smoothstep(0.,aw,d),stem);
 if(uMode==1){float sh=smoothstep(-.15,.25,d)*.2*exp(-max(vH,0.)/70.);if(sh<.01)discard;o=vec4(0.,0.,0.,sh);return;}
 if(a<.02)discard;
 vec3 c=vHue<.25?vec3(.55,.33,.13):vHue<.5?vec3(.86,.58,.18):vHue<.72?vec3(.82,.33,.09):vHue<.9?vec3(.95,.77,.25):vec3(.56,.62,.2);
 c*=.82+.36*vn(vQ*vec2(6.,9.)+vHue*40.);
 c*=mix(.68,1.,smoothstep(0.,.12,d));
 float rib=1.-smoothstep(.015,.035,abs(vQ.y));
 if(ty!=2){c=mix(c,c*1.22+.03,rib*step(-.8,vQ.x));
  float vv=abs(fract((vQ.x-abs(vQ.y)*1.1)*4.)-.5);c*=mix(.86,1.,smoothstep(0.,.08,vv));}
 else{vec2 pm=vec2(vQ.x+.25,vQ.y);float th=atan(pm.y,pm.x);float rv=abs(fract(th*2.5/3.1416+.5)-.5);c*=mix(.85,1.,smoothstep(0.,.05,rv*length(pm)));}
 if(!gl_FrontFacing)c=mix(c,vec3(dot(c,vec3(.33))),.35)*1.12;
 c=mix(c,vec3(.25,.18,.1),stem*(1.-smoothstep(0.,aw,d)));
 float lit=.5+.5*abs(dot(normalize(vN),normalize(uSun)));
 c*=uLight*lit;
 a*=1.-.4*smoothstep(4000.,9000.,vDist);
 o=vec4(c*a,a);}`;

    // 26g2: the rain (the probe's STREAK_VS / STREAK_FS / SPLASH_FS, as text). One drop = one thin streak (4 corners), all made on the
    // graphics card from the drop's number, in a box over the street outside the door (never in the hangar), hidden by the game's
    // depth. The splashes: a whole-screen pass that reads the game's depth; every flat bit of ground outside gets short rings now and
    // then (80-unit cells), like drops landing.
    const STREAK_VS = `#version 300 es
precision highp float;precision highp int;
uniform mat4 uVP;uniform vec3 uCam;uniform vec2 uViewport;
uniform float uTime,uSpeed,uLen,uWind,uWidth,uBright,uDrift,uDens,uCount;
uniform vec2 uOut,uLat;uniform vec4 uRange;uniform vec2 uZ;
out vec2 vQ;out float vA;
${HASH_GLSL}
void main(){
 uint id=uint(gl_InstanceID)*5u+11u;
 float a=rnd(id),b=rnd(id+1u),c=rnd(id+2u),d=rnd(id+3u),e=rnd(id+4u);
 float v=uSpeed*mix(.8,1.2,c);
 float w=uWind*v*.35;
 float span=max(uRange.w-uRange.z,1.),height=max(uZ.y-uZ.x,1.);
 float s=uRange.x+30.+max(uRange.y-uRange.x-30.,1.)*pow(a,1.35);
 // uDrift = the wind added up over time (wind x time while the wind does not change), so a gust's changing wind never makes the drops jump
 float u=uRange.z+span*fract(b+v*.35*uDrift/span);
 float phase=fract(d+v*uTime/height);
 vec3 head=vec3(uOut*s+uLat*u,uZ.y-phase*height);
 vec3 axis=normalize(vec3(uLat*w,-v));
 vec3 tail=head-axis*v*.022*uLen;
 vec3 toCam=uCam-head;float dist=length(toCam);
 vec3 side=cross(axis,toCam);side=length(side)<.001?vec3(uLat,0.):normalize(side);
 vec4 ch=uVP*vec4(head,1.),cs=uVP*vec4(head+side,1.);
 if(ch.w<1.||cs.w<1.){gl_Position=vec4(2.,2.,2.,1.);vQ=vec2(0.);vA=0.;return;}
 float ppu=length((cs.xy/cs.w-ch.xy/ch.w)*uViewport*.5);
 float wide=uWidth*mix(.9,1.6,e);
 float cover=min(1.,wide*ppu/.75);
 wide=max(wide,.75/max(ppu,.0001));
 float sgn=float(gl_VertexID&1)*2.-1.,along=float(gl_VertexID>>1);
 gl_Position=uVP*vec4(mix(head,tail,along)+side*sgn*wide,1.);
 vQ=vec2(sgn,along);
 vA=uBright*(.22+.28*e)*cover*smoothstep(0.,.06,phase)*(1.-smoothstep(.94,1.,phase))*smoothstep(120.,500.,dist)*(1.-smoothstep(9000.,14000.,dist));
 // gusts (v1.51): only the first uDens part of the drops shows; the others fade in as a gust gets heavier
 if(uDens<.9999)vA*=1.-smoothstep(uDens-.03,uDens,(float(gl_InstanceID)+.5)/max(uCount,1.));
}`;
    const STREAK_FS = `#version 300 es
precision highp float;
in vec2 vQ;in float vA;uniform vec3 uColor;out vec4 o;
void main(){
 float a=vA*(1.-smoothstep(.35,1.,abs(vQ.x)))*smoothstep(0.,.08,vQ.y)*(1.-.6*vQ.y);
 if(a<.002)discard;
 o=vec4(uColor*a,a);
}`;
    const SPLASH_FS = `#version 300 es
precision highp float;precision highp int;
uniform highp sampler2D uDepth;uniform mat4 uInv;uniform vec3 uCam;uniform vec2 uViewport;
uniform float uTime,uRate,uBright,uWall;uniform vec2 uOut;uniform vec3 uColor;
out vec4 o;
${HASH_GLSL}
void main(){
 float d=texelFetch(uDepth,ivec2(gl_FragCoord.xy),0).r;
 vec4 wp=uInv*vec4(gl_FragCoord.xy/uViewport*2.-1.,d*2.-1.,1.);
 vec3 p=wp.xyz/wp.w;
 vec3 n=cross(dFdx(p),dFdy(p));
 if(d>=.99999)discard;
 if(dot(p.xy,uOut)<uWall+20.)discard;
 float dist=distance(p,uCam);if(dist>7000.)discard;
 float flat_=abs(n.z)/max(length(n),.00001);if(flat_<.75)discard;
 vec2 cell=floor(p.xy/80.);
 uint key=uint(int(cell.x)+40000)*73856093u^uint(int(cell.y)+40000)*19349663u;
 float period=.3+rnd(key)*.45;
 float age=fract(uTime/period+rnd(key+1u))*period;
 if(age>.16||rnd(key+2u)>uRate)discard;
 vec2 c=(cell+.2+.6*vec2(rnd(key+3u),rnd(key+4u)))*80.;
 float r=length(p.xy-c)/(4.+age*170.);
 if(r>1.)discard;
 float ring=smoothstep(.55,.8,r)*(1.-smoothstep(.85,1.,r));
 float dot_=exp(-r*r*40.)*(1.-smoothstep(0.,.05,age));
 float a=(ring*.6+dot_*.5)*smoothstep(0.,.01,age)*(1.-smoothstep(.06,.16,age))*flat_*uBright*(1.-smoothstep(3500.,7000.,dist));
 o=vec4(uColor*a,a);
}`;
    // 26g4a: the lightning bolt (the probe's BOLT_VS / BOLT_FS, as text): the grey sky mesh drawn again, each pixel looking up the bolt
    // picture by its direction across the door and its height, added while the flash lasts.
    const BOLT_VS = `#version 300 es
precision highp float;
in vec3 aP;in vec2 aT;uniform mat4 uVP;uniform vec3 uOff;out vec3 vW;
void main(){vW=aP+uOff;gl_Position=uVP*vec4(vW,1.);}`;
    const BOLT_FS = `#version 300 es
precision highp float;
in vec3 vW;uniform sampler2D uBoltTex;uniform vec3 uCam;uniform vec2 uOut,uLat;uniform float uBolt,uFlash,uTop;out vec4 o;
void main(){vec3 d=normalize(vW-uCam);float az=atan(dot(d.xy,uLat),dot(d.xy,uOut)),el=asin(clamp(d.z,-1.,1.));
 vec2 q=vec2(az/1.2+.5,.5-el/(2.*uTop));if(q.x<=0.||q.x>=1.||q.y<=0.||q.y>=1.)discard;
 float b=texture(uBoltTex,q).r,g=textureLod(uBoltTex,q,5.).r;
 o=vec4(vec3(.86,.9,1.)*(b*1.7+g*1.6)*uBolt*pow(clamp(uFlash,0.,1.),.5),0.);}`;
    // 26g5: the wet floor by the door (the probe's WET_FS, as text): a whole-screen pass over the copied depth: the flat floor from a
    // ragged reach inside to the door, and the street outside fading out far away, darker, with puddles that mirror the picture drawn
    // so far (walked along the mirrored ray), lit in a flash, small rings in the puddles while it rains.
    const WET_FS = `#version 300 es
${DEPTH_GLSL}
uniform sampler2D uCol;uniform mat4 uVP;uniform vec2 uLat;uniform vec3 uLim,uSky,uFlashCol;
uniform float uAmt,uDepthW,uPud,uShine,uFloorZ,uFlash,uTime,uHasCol,uRings;out vec4 o;
void main(){
 Px x=look();if(x.d>=.99999)discard;
 float s=dot(x.p.xy,uOut);
 // inside: from the ragged reach to the door; outside (the street, out in the rain): wet all over, fading out far away, so there is no line
 // where the hangar's floor ends
 if(s<uWall-uDepthW*1.6-200.||s>uWall+2600.)discard;
 if(x.p.z>uFloorZ+6.||x.p.z<uFloorZ-300.)discard;
 vec3 n=cross(dFdx(x.p),dFdy(x.p));if(abs(n.z)/max(length(n),1e-5)<.9)discard;
 float l=dot(x.p.xy,uLat);
 float side=smoothstep(uLim.x,uLim.x+uLim.z,l)*(1.-smoothstep(uLim.y-uLim.z,uLim.y,l));
 side=mix(side,1.,smoothstep(uWall,uWall+300.,s));
 float nz=noise3(vec3(x.p.xy/260.,1.))*.6+noise3(vec3(x.p.xy/70.,5.))*.4;
 float reach=uWall-uDepthW*(.55+.9*nz);
 float w=smoothstep(reach-60.,reach+160.,s)*side*uAmt*(1.-smoothstep(uWall+1400.,uWall+2600.,s));
 if(w<.003)discard;
 float pn=noise3(vec3(x.p.xy/150.,9.))*.7+noise3(vec3(x.p.xy/45.,2.))*.3;
 float pud=smoothstep(.52,.66,pn)*uPud*smoothstep(reach,reach+300.,s);
 float F=.04+.96*pow(1.-abs(x.dir.z),5.);
 vec3 rd=vec3(x.dir.xy,-x.dir.z);
 rd.xy+=(vec2(noise3(vec3(x.p.xy/16.,uTime*1.3)),noise3(vec3(x.p.xy/16.+7.,uTime*1.3)))-.5)*mix(.06,.02,pud);
 rd=normalize(rd);
 vec3 rc=uSky;
 if(uHasCol>.5){
  vec3 q=x.p+vec3(0.,0.,1.);float stepL=25.;
  for(int i=0;i<40;i++){
   q+=rd*stepL;stepL*=1.09;
   vec4 c=uVP*vec4(q,1.);if(c.w<=1.)break;
   vec3 ss=c.xyz/c.w;if(abs(ss.x)>1.||abs(ss.y)>1.)break;
   vec2 uv=ss.xy*.5+.5;
   float sd=texelFetch(uDepth,ivec2(uv*uViewport),0).r;
   if(ss.z*.5+.5>sd){
    vec4 wp=uInv*vec4(ss.xy,sd*2.-1.,1.);
    float gap=distance(uCam,q)-distance(uCam,wp.xyz/wp.w);
    if(gap<stepL*1.5+40.){
     float edge=1.-smoothstep(.8,1.,max(abs(ss.x),abs(ss.y)));
     rc=mix(uSky,texture(uCol,uv).rgb,edge);}
    break;}
  }
 }
 rc+=uFlashCol*uFlash*1.2;
 float ring=0.;
 if(uRings>0.&&pud>.05){
  vec2 cell=floor(x.p.xy/55.);
  uint key=uint(int(cell.x)+40000)*73856093u^uint(int(cell.y)+40000)*19349663u;
  float period=.5+rnd(key)*.9,age=fract(uTime/period+rnd(key+1u))*period;
  if(age<.5&&rnd(key+2u)<.45*uRings){
   vec2 c=(cell+.2+.6*vec2(rnd(key+3u),rnd(key+4u)))*55.;
   float r=length(x.p.xy-c)/(2.+age*60.);
   ring=smoothstep(.6,.85,r)*(1.-smoothstep(.9,1.,r))*(1.-age/.5)*pud;}
 }
 // damp concrete mirrors a little at a low look; standing water mirrors a lot more (at least a quarter, more at a low look)
 float refl=w*uShine*mix(F*.6,.25+.75*F,pud);
 float dark=w*(.3+.25*pud);
 o=vec4(rc*refl+uSky*ring*.5*w,dark);
}`;
    // 26g5: the door drips (the probe's DRIP_VS / DRIP_FS, as text): each drop lets go from a spot on the door's top edge now and then,
    // falls faster and faster (a streak that gets longer as it speeds up), and makes a small ring on the floor where it lands.
    const DRIP_VS = `#version 300 es
precision highp float;precision highp int;
uniform mat4 uVP;uniform vec3 uCam;uniform vec2 uViewport;
uniform float uTime,uG,uTop,uGround,uAt,uWidth,uBright,uWind,uSplash;
uniform vec2 uOut,uLat,uSpan;
out vec2 vQ;out float vA;flat out int vKind;
${HASH_GLSL}
void main(){
 uint id=uint(gl_InstanceID)*6u+501u;
 float a=rnd(id),b=rnd(id+1u),c=rnd(id+2u),e=rnd(id+4u);
 float h=max(uTop-uGround,10.),T=sqrt(2.*h/uG);
 float period=T*mix(1.15,3.2,b);
 float age=fract(uTime/period+c)*period;
 float u=mix(uSpan.x,uSpan.y,a);
 float sgn=float(gl_VertexID&1)*2.-1.,along=float(gl_VertexID>>1);
 vQ=vec2(0.);vA=0.;vKind=0;gl_Position=vec4(2.,2.,2.,1.);
 float push=uWind*35.;
 if(age<T){
  float z=uTop-.5*uG*age*age,vel=uG*age;
  float drift=push*(age/T)*(age/T);
  vec3 head=vec3(uOut*uAt+uLat*(u+drift),z);
  vec3 tail=head+vec3(0.,0.,max(6.,vel*.04));
  vec3 toCam=uCam-head;float dist=length(toCam);
  vec3 side=cross(vec3(0.,0.,1.),toCam);side=length(side)<.001?vec3(uLat,0.):normalize(side);
  vec4 ch=uVP*vec4(head,1.),cs=uVP*vec4(head+side,1.);
  if(ch.w<1.||cs.w<1.)return;
  float ppu=length((cs.xy/cs.w-ch.xy/ch.w)*uViewport*.5);
  float wide=uWidth*mix(1.4,2.4,e);
  float cover=min(1.,wide*ppu/.75);wide=max(wide,.75/max(ppu,.0001));
  gl_Position=uVP*vec4(mix(head,tail,along)+side*sgn*wide,1.);
  vQ=vec2(sgn,1.-along);
  vA=uBright*mix(.35,.6,e)*cover*smoothstep(0.,.08,age/T)*smoothstep(80.,300.,dist);
  return;
 }
 float k=(age-T)/.22;
 if(uSplash<=0.||k>=1.)return;
 vec2 q=vec2(sgn,along*2.-1.);
 float r=mix(3.,26.,sqrt(k))*uSplash;
 vec3 ctr=vec3(uOut*uAt+uLat*(u+push),uGround+1.5);
 gl_Position=uVP*vec4(ctr+(vec3(uOut,0.)*q.x+vec3(uLat,0.)*q.y)*r,1.);
 vQ=q;vKind=1;
 vA=uBright*.7*uSplash*(1.-k)*smoothstep(80.,300.,distance(uCam,ctr));
}`;
    const DRIP_FS = `#version 300 es
precision highp float;
in vec2 vQ;in float vA;flat in int vKind;uniform vec3 uColor;out vec4 o;
void main(){float a;
 if(vKind==0)a=vA*(1.-smoothstep(.3,1.,abs(vQ.x)))*mix(.3,1.,vQ.y);
 else{float r=length(vQ);a=vA*(smoothstep(.55,.82,r)*(1.-smoothstep(.86,1.,r))*.8+exp(-r*r*30.)*.35);}
 if(a<.002)discard;o=vec4(uColor*a,a);}`;
    // the foggy looks' extras (26h): mode 0 = the door beam's lit patch (multiplies), mode 1 = the floor fog, the fog banks, the light
    // shaft through the door, the night's searchlight and the ring lamps' cones (laid over); the probe's own text
    const FOGX_FS = `#version 300 es
${DEPTH_GLSL}
uniform mat4 uVP;uniform vec2 uLat;uniform vec3 uRoomMax;uniform float uTime,uFloorZ,uGroundZ,uFar;uniform int uMode;
uniform float uFlAmt,uFlH,uFlDepth,uFlSpeed,uFlLump,uFlOutR;uniform vec3 uFlIn,uFlOutC;
uniform float uBkAmt,uBkSize,uBkSpeed,uBkGap,uBkHigh,uBkStart;uniform vec3 uBkCol;
uniform float uBmAmt,uBmPool,uBmDust,uBmSoft;uniform vec3 uBmCol,uBmDir,uDoor;
uniform float uSkyZ,uSkyNear,uSkyLow;
uniform float uSlAmt,uSlW;uniform vec3 uSlO,uSlD,uSlCol;
uniform float uCnAmt,uCnTan,uCnReach,uCnDust;uniform vec3 uCnCol;uniform vec3 uCnLamp[8];uniform int uCnN;
out vec4 o;
float ign(){return fract(52.9829189*fract(dot(gl_FragCoord.xy,vec2(.06711056,.00583715))));}
// how much of the door's light reaches q: 1 inside the shaft, soft at its edges, weaker the further it has come in
float shaft(vec3 q,out float ray){
 ray=1.;float s=dot(q.xy,uOut);if(s>uWall)return 0.;
 vec3 bk=-uBmDir;float bo=dot(bk.xy,uOut);if(bo<.02)return 0.;
 float t=(uWall-s)/bo;vec3 d=q+bk*t;float l=dot(d.xy,uLat);
 // rays: where the light came through the door (across its width, a little up and down) decides a streak, so the streaks run along the light
 ray=noise3(vec3(l/70.,d.z/420.,uTime*.06))*.7+noise3(vec3(l/23.,d.z/160.,uTime*.1+4.))*.3;
 return smoothstep(uDoor.x,uDoor.x+uBmSoft,l)*(1.-smoothstep(uDoor.y-uBmSoft,uDoor.y,l))
  *(1.-smoothstep(uDoor.z-uBmSoft,uDoor.z,d.z))*step(uFloorZ-60.,d.z)*exp(-t/1800.);}
// 0 when something drawn in the picture (the tank, the platform) stands between p and the door along the light
float unshaded(vec3 p){vec3 q=p+vec3(0.,0.,3.);float st=18.;
 for(int i=0;i<24;i++){q-=uBmDir*st;st*=1.12;
  if(dot(q.xy,uOut)>uWall)return 1.;
  vec4 c=uVP*vec4(q,1.);if(c.w<=1.)return 1.;vec3 ss=c.xyz/c.w;if(abs(ss.x)>1.||abs(ss.y)>1.)return 1.;
  float sd=texelFetch(uDepth,ivec2(clamp((ss.xy*.5+.5)*uViewport,vec2(0.),uViewport-1.)),0).r;
  if(ss.z*.5+.5>sd){vec4 w=uInv*vec4(ss.xy,sd*2.-1.,1.);float gap=distance(uCam,q)-distance(uCam,w.xyz/w.w);if(gap>4.&&gap<140.)return 0.;}}
 return 1.;}
void main(){
 Px x=look();vec3 nr=cross(dFdx(x.p),dFdy(x.p));
 if(uMode==0){
  if(x.d>=.99999||dot(x.p.xy,uOut)>uWall)discard;
  float ln=length(nr);vec3 n=ln>0.?nr/ln:vec3(0.,0.,1.);if(dot(n,uCam-x.p)<0.)n=-n;
  float ray;float face=max(dot(n,-uBmDir),0.),sh=shaft(x.p,ray)*face*mix(1.,.55+.9*ray,uBmDust*.6);
  if(sh<.003)discard;
  sh*=unshaded(x.p);if(sh<.003)discard;
  o=vec4(uBmCol*sh*uBmPool,1.);return;}
 float L=x.d>=.99999?1e7:x.dist;vec3 c=uCam,dv=x.dir;float j=ign();
 float s0=dot(c.xy,uOut),ds=dot(dv.xy,uOut);
 float tau=0.;vec3 col=vec3(0.);
 if(uFlAmt>0.){
  float top=uFloorZ+uFlH*3.,t0=-1.,t1=min(L,6000.);
  if(c.z<top)t0=0.;else if(dv.z<-1e-4)t0=(top-c.z)/dv.z;
  if(dv.z>1e-4&&c.z<top)t1=min(t1,(top-c.z)/dv.z);
  if(t0>=0.&&t1>t0){float dt=(t1-t0)/10.;
   for(int i=0;i<10;i++){vec3 q=c+dv*(t0+(float(i)+j)*dt);float s=dot(q.xy,uOut);
    float front=uWall-uFlDepth*(.5+noise3(vec3(dot(q.xy,uLat)/650.,uTime*uFlSpeed*.025,1.)));
    float m=smoothstep(front-200.,front+300.,s)*(1.-smoothstep(uWall+uFlOutR*.35,uWall+uFlOutR+1.,s));
    if(m<.001)continue;
    vec3 nq=vec3((q.xy+uOut*uTime*uFlSpeed*22.)/170.,q.z/70.+uTime*uFlSpeed*.05);
    float n=noise3(nq)*.65+noise3(nq*2.3+5.)*.35;
    float a=exp(-max(q.z-uFloorZ,0.)/max(uFlH,1.))*m*mix(1.,smoothstep(.25,.8,n)*1.8,uFlLump)*dt*.006*uFlAmt;
    tau+=a;col+=a*mix(uFlIn,uFlOutC,smoothstep(uWall-400.,uWall+300.,s));}}}
 if(uBkAmt>0.&&ds>1e-3){
  float tA=max(0.,(uWall+max(uBkStart,40.)-s0)/ds),tB=min(L,(uFar-s0)/ds);
  if(tB>tA){float dt=(tB-tA)/14.;
   for(int i=0;i<14;i++){vec3 q=c+dv*(tA+(float(i)+j)*dt);
    vec3 nq=vec3((q.xy+uLat*uTime*uBkSpeed*45.)/uBkSize,q.z/(uBkSize*.5)+uTime*uBkSpeed*.012);
    float n=noise3(nq)*.7+noise3(nq*2.1+3.)*.3;
    float a=exp(-max(q.z-uGroundZ,0.)/max(uBkHigh,1.))*mix(1.,smoothstep(.4,.68,n)*2.6,uBkGap)*dt*.0003*uBkAmt;
    tau+=a;col+=a*uBkCol;}}}
 vec3 add=vec3(0.);
 // v1.59 the searchlight: a beam from far out in the town, leaning and swinging slowly, seen where it passes in front of what the pixel
 // shows (the sky counts as endless); brightest near its foot, softer and wider higher up
 if(uSlAmt>0.){
  bool sky=x.d>=.99999||x.p.z>uSkyZ||(dot(x.p.xy,uOut)>uSkyNear-60.&&x.p.z>uSkyLow);
  float Lb=sky?1e7:L;
  vec3 w0=c-uSlO;float b=dot(dv,uSlD),d1=dot(dv,w0),e1=dot(uSlD,w0),den=max(1.-b*b,1e-4);
  float t=(b*e1-d1)/den,u=(e1-b*d1)/den;
  if(t>0.&&t<Lb&&u>0.){
   float dist=length(c+dv*t-(uSlO+uSlD*u)),w=uSlW*(45.+u*.055);
   float k=exp(-dist*dist/(w*w)*1.6)*smoothstep(0.,400.,u)*(1.-smoothstep(9000.,16000.,u))*(70./(45.+u*.02));
   float n=noise3(vec3(u/500.-uTime*.15,dist/90.,uTime*.05));
   add+=uSlCol*k*mix(.75,1.25,n)*uSlAmt*.55;}}
 // v1.59 the hangar lamps' cones: each lamp shines down, and the fog inside lights up in a cone under it (with slow swirls)
 if(uCnAmt>0.&&uCnN>0&&s0<uWall){
  float tE=min(L,4000.);if(ds>1e-4)tE=min(tE,(uWall-s0)/ds);
  float dt=tE/16.,sum=0.;
  for(int i=0;i<16;i++){vec3 q=c+dv*((float(i)+j)*dt);if(q.z<uFloorZ)continue;
   float lit=0.;
   for(int k=0;k<8;k++){if(k>=uCnN)break;vec3 v=q-uCnLamp[k];float down=-v.z;if(down<5.)continue;
    float r=length(v.xy),edge=down*uCnTan+12.;
    lit+=(1.-smoothstep(edge*.65,edge,r))/(1.+down*down/(uCnReach*uCnReach))*smoothstep(5.,40.,down);}
   if(lit<.001)continue;
   float n=noise3(vec3((q.xy+uLat*uTime*8.)/90.,q.z/90.+uTime*.04));
   sum+=lit*mix(1.,.4+1.2*n,uCnDust)*dt;}
  add+=uCnCol*sum*.0011*uCnAmt;}
 if(uBmAmt>0.&&s0<uWall){
  float tE=min(L,5000.);if(ds>1e-4)tE=min(tE,(uWall-s0)/ds);
  float dt=tE/14.,sum=0.;
  for(int i=0;i<14;i++){vec3 q=c+dv*((float(i)+j)*dt);if(q.z>uRoomMax.z||q.z<uFloorZ)continue;
   float ray;float sh=shaft(q,ray);if(sh<.001)continue;
   float n=noise3(vec3((q.xy-uLat*uTime*12.)/120.,q.z/120.+uTime*.03));
   sum+=sh*mix(1.,smoothstep(.3,.75,ray)*1.6+.1,uBmDust)*mix(1.,.6+.8*n,uBmDust*.5)*dt;}
  add=uBmCol*sum*.00012*uBmAmt;}
 float f=1.-exp(-tau);vec3 fc=tau>0.?col/tau:vec3(0.);
 if(f<.002&&dot(add,vec3(1.))<.002)discard;
 o=vec4(fc*f+add*(1.-f),f);}`;
    // falling and floating specks: mode 0 = snow outside, mode 1 = the dust floating in the hangar's light (26h), mode 2 = snow blown
    // inside; the probe's own text
    const FLAKE_VS = `#version 300 es
precision highp float;precision highp int;
uniform mat4 uVP;uniform vec3 uCam;uniform vec2 uViewport;uniform float uTime,uSpeed,uSize,uWind,uSway,uBright,uDrift,uGust;uniform int uMode;
uniform int uLampN;uniform float uLampStart,uLampGap,uLampZ,uLampR,uLampGlow;uniform vec2 uLampSides;
uniform vec2 uOut,uLat;uniform vec4 uRange;uniform vec2 uZ;uniform vec3 uRoomMin,uRoomMax;
out vec2 vQ;out float vA;out float vRot;out float vShape;out float vWarm;
${HASH_GLSL}
void main(){
 vWarm=0.;
 uint id=uint(gl_InstanceID)*7u+101u;
 float a=rnd(id),b=rnd(id+1u),c=rnd(id+2u),d=rnd(id+3u),e=rnd(id+4u),g=rnd(id+5u);
 vec3 pos;float size,alpha,flk=0.,rot=0.;
 if(uMode!=1){
  // v1.50 snow made more real: mostly small flakes and a few big clumps (the big ones fall a little faster and swing wider); each flake
  // circles as it falls (a spiral, its own speed and width); gusts come and go for all flakes together; a flake tumbles as it falls,
  // so it flickers as its flat side turns to the light; its outline is ragged, not a perfect dot; flakes near the eye are bigger and
  // softer (out of focus)
  float big=pow(e,3.);
  float v=uSpeed*mix(.75,1.25,c)*mix(.9,1.3,big);
  float gust=1.+uGust*1.5;
  float ph=e*6.2832+uTime*mix(.5,1.4,g),sw=uSway*mix(20.,60.,d)*mix(1.,1.6,big)*gust;
  vec2 spiral=vec2(sin(ph),cos(ph))*sw;
  if(uMode==0){
   float span=max(uRange.w-uRange.z,1.),height=max(uZ.y-uZ.x,1.);
   float s=uRange.x+30.+max(uRange.y-uRange.x-30.,1.)*pow(a,1.35);
   float u=uRange.z+span*fract(b+uDrift/span);
   float phase=fract(d+v*uTime/height);
   pos=vec3(uOut*(s+spiral.y*.5)+uLat*(u+spiral.x),uZ.y-phase*height);
   alpha=smoothstep(0.,.05,phase)*(1.-smoothstep(.95,1.,phase));
   // v1.74 near a street lamp a flake is lit by it (warm, brighter): the lamps stand where the street lamps are drawn
   if(uLampN>0){float w=0.;
    for(int i=0;i<24;i++){if(i>=uLampN)break;
     float sd=(i%2==0)?uLampSides.x:uLampSides.y,sAt=uLampStart+float(i/2)*uLampGap+(i%2==1?uLampGap*.5:0.);
     vec3 d=pos-vec3(uOut*sAt+uLat*sd,uLampZ);w+=exp(-dot(d,d)/(uLampR*uLampR))*(d.z<0.?1.:.6);}
    vWarm=min(3.,w*uLampGlow);}
  }else{
   // inside: spread through the hangar's room like the dust in the light, falling slowly (sheltered), drifting with the wind,
   // fading in at the roof, out at the floor and at the room's sides (so a flake that wraps round never pops)
   vec3 ext=max(uRoomMax-uRoomMin,vec3(1.));
   float phase=fract(d+v*.6*uTime/ext.z);
   vec2 xy=fract(vec2(a,b)+uLat*uDrift*.5/ext.xy);
   pos=vec3(uRoomMin.xy+ext.xy*xy+vec2(spiral.x,spiral.y*.5),uRoomMax.z-phase*ext.z);
   alpha=smoothstep(0.,.08,phase)*(1.-smoothstep(.92,1.,phase))
    *smoothstep(0.,.06,xy.x)*(1.-smoothstep(.94,1.,xy.x))*smoothstep(0.,.06,xy.y)*(1.-smoothstep(.94,1.,xy.y));
  }
  size=uSize*mix(3.5,10.,e*e)*mix(1.,1.4,big);
  float tumble=abs(sin(uTime*mix(1.5,4.,c)+g*6.2832));
  alpha*=uBright*mix(.55,1.,g)*mix(.5,1.,tumble);
  rot=a*6.2832+uTime*mix(-1.5,1.5,b);flk=1.;
 }else{
  pos=uRoomMin+(uRoomMax-uRoomMin)*vec3(a,b,c)+vec3(sin(uTime*.13*mix(.5,1.5,d)+e*6.28),cos(uTime*.11*mix(.5,1.5,e)+g*6.28),sin(uTime*.09+d*6.28))*60.;
  size=uSize*mix(1.2,3.,e);
  alpha=uBright*mix(.15,.6,g)*(.5+.5*sin(uTime*mix(.5,2.,a)+d*6.28));
 }
 vec3 toCam=uCam-pos;float dist=length(toCam);
 vec4 ch=uVP*vec4(pos,1.);
 vRot=rot;vShape=0.;
 if(ch.w<1.){gl_Position=vec4(2.,2.,2.,1.);vQ=vec2(0.);vA=0.;return;}
 if(flk>.5){float near=1.-smoothstep(150.,700.,dist);size*=1.+.6*near;alpha*=1.-.35*near;vShape=1.+near;}
 vec3 side=cross(vec3(0.,0.,1.),toCam);side=length(side)<.001?vec3(1.,0.,0.):normalize(side);vec3 up=normalize(cross(toCam,side));
 vec4 cs=uVP*vec4(pos+side,1.);float ppu=length((cs.xy/cs.w-ch.xy/ch.w)*uViewport*.5);
 float cover=min(1.,size*ppu/1.5);size=max(size,1.5/max(ppu,.0001));
 vec2 q=vec2(float(gl_VertexID&1)*2.-1.,float(gl_VertexID>>1)*2.-1.);
 gl_Position=uVP*vec4(pos+(side*q.x+up*q.y)*size,1.);vQ=q;
 vA=alpha*cover*smoothstep(60.,250.,dist);
}`;
    const FLAKE_FS = `#version 300 es
precision highp float;
in vec2 vQ;in float vA;in float vRot;in float vShape;in float vWarm;uniform vec3 uColor,uLampCol;uniform float uAlphaMul;out vec4 o;
void main(){
 float a;
 if(vShape<.5){a=vA*(1.-smoothstep(.25,1.,length(vQ)));}
 else{
  // a snowflake: a ragged, slowly turning outline with a brighter core; out of focus (near the eye) = rounder and softer
  float blur=vShape-1.;
  vec2 q=mat2(cos(vRot),sin(vRot),-sin(vRot),cos(vRot))*vQ;
  float r=length(q),an=atan(q.y,q.x);
  float edge=mix(.8+.1*sin(an*6.)+.07*sin(an*3.+1.7),.92,blur);
  a=vA*min(1.,(1.-smoothstep(mix(.3,.05,blur)*edge,edge,r))*.8+.35*exp(-r*r*mix(14.,5.,blur)));
 }
 a*=1.+vWarm*.6;if(a<.003)discard;o=vec4((uColor+uLampCol*vWarm)*a,min(1.,a*uAlphaMul));}`;
    // the very sunny day's heat shimmer (26i): the picture drawn so far read again, shifted by small rising ripples low over the
    // street; the probe's own text
    const SUNX_FS = `#version 300 es
${DEPTH_GLSL}
uniform sampler2D uCol;uniform float uTime,uGroundZ,uSkyZ,uSkyNear,uSkyLow;
uniform float uShAmt,uShH,uShSpeed;out vec4 o;
void main(){
 Px x=look();if(x.d>=.99999)discard;
 bool sky=x.p.z>uSkyZ||(dot(x.p.xy,uOut)>uSkyNear-60.&&x.p.z>uSkyLow);if(sky)discard;
 float h=x.p.z-uGroundZ;if(x.k<.3||h>uShH*3.||x.dist<500.)discard;
 float m=x.k*exp(-max(h,0.)/max(uShH,1.))*smoothstep(500.,2500.,x.dist)*uShAmt;
 if(m<.01)discard;
 // ripples of a fixed size on the screen (wide and flat, rising), so they wobble the same near and far
 vec3 nq=vec3(gl_FragCoord.x/26.,gl_FragCoord.y/9.-uTime*uShSpeed*3.,uTime*.4);
 vec2 off=(vec2(noise3(nq),noise3(nq+vec3(5.2,1.3,7.7)))-.5)*m*vec2(4.,2.);
 vec2 uv=clamp((gl_FragCoord.xy+off)/uViewport,vec2(0.),vec2(1.));
 float a=min(1.,m*1.5);o=vec4(texture(uCol,uv).rgb*a,a);}`;
    // birds flying over the street (26i; the Halloween bats later use its uBat), hidden by the game's depth; the probe's own text
    const BIRD_VS = `#version 300 es
precision highp float;precision highp int;
uniform mat4 uVP;uniform vec3 uCam;uniform vec2 uOut,uLat,uDist,uZ,uSpan;uniform float uTime,uSize,uSpeed,uBat;uniform vec4 uOne;
out vec2 vQ;out float vFlap;out float vDist;
${HASH_GLSL}
void main(){
 uint id=uint(gl_InstanceID)*5u+211u;float a=rnd(id),b=rnd(id+1u),c=rnd(id+2u),d=rnd(id+3u),e=rnd(id+4u);
 float w=max(uSpan.y-uSpan.x,1.),dir=d<.5?-1.:1.,v=uSpeed*mix(220.,420.,e);
 float lat=uSpan.x+w*fract(c+dir*v*uTime/w);
 float sOut=mix(uDist.x,uDist.y,a),z=mix(uZ.x,uZ.y,b)+sin(uTime*.6+a*6.28)*40.;
 vec3 p=vec3(uOut*sOut+uLat*lat,z);
 p.z+=uBat*sin(uTime*2.3+a*9.)*70.;if(uOne.w>.5&&gl_InstanceID==0)p=uOne.xyz;
 vec2 q=vec2(float(gl_VertexID&1)*2.-1.,float(gl_VertexID>>1)*2.-1.);vQ=q;
 vFlap=mix(sin(uTime*mix(7.,11.,e)+a*20.)*step(.3,fract(uTime*.13+b))+ (1.-step(.3,fract(uTime*.13+b)))*.15,sin(uTime*mix(16.,22.,e)+a*20.),uBat);vDist=distance(uCam,p);
 vec3 f=normalize(uCam-p),r=normalize(cross(vec3(0.,0.,1.),f)),u=cross(f,r);
 float sz=uSize*mix(35.,60.,c);gl_Position=uVP*vec4(p+(r*q.x+u*q.y*.7)*sz,1.);}`;
    const BIRD_FS = `#version 300 es
precision highp float;
uniform vec3 uHaze;in vec2 vQ;in float vFlap;in float vDist;out vec4 o;
void main(){float ax=abs(vQ.x);if(ax>1.)discard;
 float yw=vFlap*.55*ax-.18*ax*(1.-ax);float th=mix(.16,.05,ax);
 float a=1.-smoothstep(th*.5,th,abs(vQ.y-yw));
 a=max(a,1.-smoothstep(.1,.16,length(vQ*vec2(1.,1.6))));
 if(a<.02)discard;float far=smoothstep(2000.,11000.,vDist);
 vec3 c=mix(vec3(.07,.07,.08),uHaze,far*.7);a*=mix(1.,.55,far);o=vec4(c*a,a);}`;
    // the snowy day's icicles hanging from the door's top edge (26j); the probe's own text
    const ICE_VS = `#version 300 es
precision highp float;precision highp int;
uniform mat4 uVP;uniform vec3 uCam;uniform vec2 uOut,uLat,uSpan;uniform float uTop,uAt,uLen,uWidth,uN;
out vec2 vQ;out float vSeed;
${HASH_GLSL}
void main(){
 uint id=uint(gl_InstanceID)*5u+2711u;
 float a=rnd(id),b=rnd(id+1u),c=rnd(id+2u);
 float u=mix(uSpan.x,uSpan.y,(float(gl_InstanceID)+a*.9)/max(uN,1.));
 float cl=.5+.5*abs(sin(u/230.+b*3.)*sin(u/97.+c*5.));
 float len=uLen*mix(.2,1.,pow(b,1.6))*cl;
 vec3 head=vec3(uOut*uAt+uLat*u,uTop+3.);
 vec3 to=uCam-head;vec3 side=cross(vec3(0.,0.,1.),to);side=length(side)<.001?vec3(uLat,0.):normalize(side);
 vec2 q=gl_VertexID==0?vec2(-1.,0.):(gl_VertexID==1?vec2(1.,0.):vec2(0.,1.));
 vQ=q;vSeed=a;
 gl_Position=uVP*vec4(head+side*q.x*uWidth*mix(7.,15.,c)-vec3(0.,0.,q.y*len),1.);}`;
    const ICE_FS = `#version 300 es
precision highp float;
uniform vec3 uColor;uniform float uTime,uGlint;in vec2 vQ;in float vSeed;out vec4 o;
void main(){
 float sx=vQ.x/max(1.-vQ.y,.02);
 float body=.5+.4*(1.-abs(sx))+.35*vQ.y;
 float g=pow(max(0.,sin(uTime*1.1+vSeed*60.)),30.)*uGlint*smoothstep(.45,1.,vQ.y);
 vec3 c=uColor*body+vec3(1.)*g;float a=.8;
 o=vec4(c*a,a);}`;
    // the snow blown in on the floor just inside the door (26j); the probe's own text
    const DRIFT_FS = `#version 300 es
${DEPTH_GLSL}
uniform vec2 uLat;uniform vec3 uLim,uCol;
uniform float uAmt,uDepthW,uGust,uFloorZ,uTime,uSpark;out vec4 o;
void main(){
 Px x=look();if(x.d>=.99999)discard;
 float s=dot(x.p.xy,uOut);
 if(s<uWall-uDepthW*2.4-100.||s>uWall+200.)discard;
 if(x.p.z>uFloorZ+8.||x.p.z<uFloorZ-60.)discard;
 vec3 n=cross(dFdx(x.p),dFdy(x.p));if(abs(n.z)/max(length(n),1e-5)<.9)discard;
 float l=dot(x.p.xy,uLat);
 float side=smoothstep(uLim.x,uLim.x+uLim.z,l)*(1.-smoothstep(uLim.y-uLim.z,uLim.y,l));
 float t1=noise3(vec3(l/110.,s/520.,3.))*.6+noise3(vec3(l/38.,s/180.,8.))*.4;
 float reach=uWall-uDepthW*(.45+.9*t1)*(1.+.5*uGust);
 float f=clamp((s-reach)/max(uWall-reach,1.),0.,1.);
 float cov=smoothstep(.0,.35,f)*smoothstep(.25,.55,t1*.8+f*.55);
 cov*=1.-smoothstep(uWall-10.,uWall+200.,s);
 float a=cov*side*uAmt;
 if(a<.004)discard;
 float shade=mix(.8,1.,cov)*(.9+.1*noise3(vec3(x.p.xy/14.,1.)));
 vec2 cell=floor(x.p.xy/11.);
 uint k=uint(int(cell.x)+70000)*73856093u^uint(int(cell.y)+70000)*19349663u;
 float gl2=step(.975,rnd(k))*pow(max(0.,sin(uTime*(1.5+rnd(k+1u)*3.)+rnd(k+2u)*6.28)),8.);
 vec3 col=uCol*shade+vec3(1.)*gl2*uSpark;
 a=min(1.,a);o=vec4(col*a,a);}`;
    // the seasonal outside (26k): the game's depth emptied beyond the door before the season's own sky and town are drawn; the probe's own text
    const CLEAR_FS = `#version 300 es
${DEPTH_GLSL}
out vec4 o;void main(){Px x=look();if(x.d>=.99999||dot(x.p.xy,uOut)<uWall+40.)discard;gl_FragDepth=1.;o=vec4(0.);}`;
    // the Halloween night (26k): the pumpkins' candle light on what is round them (multiplies); the probe's own text
    const HWX_FS = `#version 300 es
${DEPTH_GLSL}
uniform vec4 uC[32];uniform int uN;uniform float uR,uAmt,uDim;uniform vec3 uCol;out vec4 o;
void main(){Px x=look();if(x.d>=.99999)discard;
 vec3 n=cross(dFdx(x.p),dFdy(x.p));float ln=length(n);n=ln>0.?n/ln:vec3(0.,0.,1.);if(dot(n,uCam-x.p)<0.)n=-n;
 float L=0.;
 for(int i=0;i<32;i++){if(i>=uN)break;vec3 d=uC[i].xyz-x.p;float r=length(d);
  L+=(max(dot(n,d/max(r,1.)),0.)*.8+.2)/(1.+r*r/(uR*uR))*(1.-smoothstep(uR*1.5,uR*3.,r))*uC[i].w;}
 if(L<.003)discard;o=vec4(uCol*L*uAmt*.5/uDim,1.);}`;
    // small glowing points facing the camera (26k): mode 0 the pumpkins' candles, mode 1 the string lights; the probe's own text
    const GLOW_VS = `#version 300 es
precision highp float;precision highp int;
uniform mat4 uVP;uniform vec3 uCam;uniform vec4 uP[96];uniform float uSize,uPull;
out vec2 vQ;out float vI;
void main(){vec4 P=uP[gl_InstanceID];vec3 p=P.xyz;vec3 f=normalize(uCam-p);p+=f*uPull;
 vec3 r=normalize(cross(vec3(0.,0.,1.),f)),u=cross(f,r);
 vec2 q=vec2(float(gl_VertexID&1)*2.-1.,float(gl_VertexID>>1)*2.-1.);vQ=q;vI=P.w;
 gl_Position=uVP*vec4(p+(r*q.x+u*q.y)*uSize,1.);}`;
    const GLOW_FS = `#version 300 es
precision highp float;precision highp int;
uniform vec3 uC0,uC1;uniform float uBright,uTime,uBlink;uniform int uMode;in vec2 vQ;in float vI;out vec4 o;
void main(){float r=length(vQ);if(r>1.)discard;
 float ph=fract(vI)*6.2832,k;vec3 col;
 if(uMode==0){k=.75+.25*sin(uTime*11.+ph*3.)*sin(uTime*7.3+ph)+.1*sin(uTime*23.+ph*5.);col=uC0;}
 else if(uMode==2){vec3 pal[4]=vec3[4](vec3(1.,.15,.1),vec3(.2,1.,.3),vec3(1.,.75,.2),vec3(.95,.95,1.));col=pal[int(floor(vI))%4];
  k=uBlink>.01?.35+.65*(.5+.5*sin(uTime*uBlink*2.+ph)):1.;}
 else if(uMode==3){col=uC0;k=.85+.15*sin(uTime*2.+ph);}
 else{k=uBlink>.01?.3+.7*smoothstep(-.2,.2,sin(uTime*uBlink*2.+ph)):1.;col=floor(vI)>.5?uC1:uC0;}
 vec3 c=col*uBright*k*(uMode==0?exp(-r*r*4.)*.3:uMode==3?exp(-r*r*25.)*2.5+exp(-r*r*3.)*.4:exp(-r*r*40.)*2.+exp(-r*r*5.)*.25);
 if(max(c.r,max(c.g,c.b))<.003)discard;o=vec4(c,0.);}`;
    // the spider webs in the door's top corners (26k); the probe's own text
    const WEB_VS = `#version 300 es
precision highp float;precision highp int;
uniform mat4 uVP;uniform vec4 uW[8];uniform vec2 uLat;uniform float uSize;out vec2 vU;
void main(){vec4 W=uW[gl_InstanceID];vec2 q=vec2(float(gl_VertexID&1),float(gl_VertexID>>1));vU=q;
 gl_Position=uVP*vec4(W.xyz+(vec3(uLat*W.w,0.)*q.x-vec3(0.,0.,1.)*q.y)*uSize,1.);}`;
    const WEB_FS = `#version 300 es
precision highp float;
uniform vec3 uCol;uniform float uAmt,uTime;in vec2 vU;out vec4 o;
void main(){float r=length(vU);if(r>1.)discard;float an=atan(vU.y,vU.x);
 float k=an/1.5708*7.;float ds=abs(fract(k+.5)-.5)/7.*1.5708*r;
 float rr=r+.025*sin(fract(k)*3.1416)+.004*sin(uTime*.8+r*20.);
 float dr=(r<.93&&r>.06)?abs(fract(rr/.1+.5)-.5)*.1:1.;
 float w=fwidth(r)*1.1+.0015,line=min(ds,dr);
 float a=(1.-smoothstep(w*.4,w*1.4,line))*uAmt*(1.-smoothstep(.85,1.,r));
 if(a<.01)discard;o=vec4(uCol*a,a);}`;
    // the wrapped gifts under the Christmas tree (26l): a box each, a ribbon round it both ways, lit from above; the probe's own text
    const GIFT_VS = `#version 300 es
precision highp float;precision highp int;
uniform mat4 uVP;uniform vec4 uG[12],uGs[12];out vec3 vL;out vec3 vN;flat out int vI;
void main(){int f=gl_VertexID/6,k=gl_VertexID%6;int c=k==0?0:k==1?1:k==2?2:k==3?2:k==4?1:3;
 vec2 q=vec2(float(c&1),float(c>>1))*2.-1.;vec3 n,p;
 if(f==0){n=vec3(1.,0.,0.);p=vec3(1.,q.x,q.y);}else if(f==1){n=vec3(-1.,0.,0.);p=vec3(-1.,q.y,q.x);}
 else if(f==2){n=vec3(0.,1.,0.);p=vec3(q.y,1.,q.x);}else if(f==3){n=vec3(0.,-1.,0.);p=vec3(q.x,-1.,q.y);}
 else if(f==4){n=vec3(0.,0.,1.);p=vec3(q.x,q.y,1.);}else{n=vec3(0.,0.,-1.);p=vec3(q.y,q.x,-1.);}
 vec4 G=uG[gl_InstanceID],Z=uGs[gl_InstanceID];float cs=cos(G.w),sn=sin(G.w);
 vec3 l=p*Z.xyz*.5;l.z+=Z.z*.5;vL=p;vI=int(Z.w+.5);
 vN=vec3(cs*n.x-sn*n.y,sn*n.x+cs*n.y,n.z);
 gl_Position=uVP*vec4(G.xyz+vec3(cs*l.x-sn*l.y,sn*l.x+cs*l.y,l.z),1.);}`;
    const GIFT_FS = `#version 300 es
precision highp float;precision highp int;
uniform vec3 uLight;in vec3 vL;in vec3 vN;flat in int vI;out vec4 o;
void main(){vec3 pal[5]=vec3[5](vec3(.75,.08,.08),vec3(.1,.5,.18),vec3(.12,.25,.7),vec3(.85,.65,.15),vec3(.8,.82,.86));
 vec3 c=pal[vI%5],rb=vI%5==3?vec3(.75,.1,.1):vec3(.95,.8,.3);
 float band=max(1.-smoothstep(.1,.14,abs(vL.x)),1.-smoothstep(.1,.14,abs(vL.y)));
 c=mix(c,rb,band);float sh=.45+.55*max(dot(normalize(vN),normalize(vec3(.3,.45,.85))),0.);
 o=vec4(c*sh*uLight,1.);}`;
    // the fireplace's fire (26l, the probe's v1.88 FIRE, its own text): moving flames (tall soft tongues that bend and flicker,
    // white-yellow at the heart, orange, then deep red at the edges, breaking up at the top), the glowing bed of embers under the logs
    // and the sparks rising from it; added over the picture after the night's colours, so they glow
    const FIRE_VS = `#version 300 es
precision highp float;precision highp int;
uniform mat4 uVP;uniform vec3 uCam;uniform vec4 uP[48],uQ[48];uniform float uTime,uPull;
out vec2 vQ;flat out vec4 vD;
void main(){vec4 P=uP[gl_InstanceID],Q=uQ[gl_InstanceID];vec3 p=P.xyz;vec3 f=uCam-p;int mode=int(Q.w+.5);
 vec2 c=vec2(float(gl_VertexID&1)*2.-1.,float(gl_VertexID>>1));vec3 r,u;
 if(mode==1){vec3 fn=normalize(f);r=normalize(cross(vec3(0.,0.,1.),fn));u=cross(fn,r);c.y=c.y*2.-1.;}
 else{vec3 fh=normalize(vec3(f.xy,0.)+vec3(1e-4,0.,0.));r=normalize(cross(vec3(0.,0.,1.),fh));u=vec3(0.,0.,1.);}
 vQ=c;vD=vec4(P.w,Q.z,Q.w,0.);
 float h=Q.y;if(mode==0)h*=.85+.15*sin(uTime*7.+P.w*40.)+.08*sin(uTime*13.1+P.w*17.);
 p+=normalize(f)*uPull;
 gl_Position=uVP*vec4(p+r*c.x*Q.x+u*(mode==1?c.y*Q.x:c.y*h),1.);}`;
    const FIRE_FS = `#version 300 es
precision highp float;precision highp int;
uniform float uTime,uBright;in vec2 vQ;flat in vec4 vD;out vec4 o;
float hh(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float vn(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(hh(i),hh(i+vec2(1.,0.)),f.x),mix(hh(i+vec2(0.,1.)),hh(i+1.),f.x),f.y);}
float fbm(vec2 p){return vn(p)*.55+vn(p*2.1+3.7)*.3+vn(p*4.3+1.3)*.15;}
vec3 ramp(float t){return t<.33?mix(vec3(.25,.02,0.),vec3(.95,.25,.03),t/.33):t<.66?mix(vec3(.95,.25,.03),vec3(1.,.62,.15),(t-.33)/.33):mix(vec3(1.,.62,.15),vec3(1.,.93,.7),(t-.66)/.34);}
void main(){int mode=int(vD.z+.5);float s=vD.x,t=uTime;vec3 col;
 if(mode==0){float y=vQ.y,x=vQ.x;
  float n=fbm(vec2(x*1.6+s*13.,y*2.2-t*2.4)),n2=fbm(vec2(x*3.5-s*7.,y*4.5-t*3.6));
  float xx=x+(n-.5)*.9*y+(n2-.5)*.25*y;
  float w=.95*pow(max(1.-y,0.),.75)*sqrt(smoothstep(-.02,.12,y));
  float d=1.-abs(xx)/max(w,.001);
  float top=1.-smoothstep(.35,1.,y+(n2-.5)*.5);
  float I=smoothstep(0.,.55,d)*top;if(I<.004)discard;
  float tmp=clamp(I*(1.15-y*.55),0.,1.);col=ramp(tmp)*(.35+1.1*tmp)*I;
 }else if(mode==2){float y=vQ.y,x=vQ.x;
  float e=max(1.-x*x,0.)*(1.-smoothstep(.3,1.,y))*smoothstep(0.,.15,y);
  float n=fbm(vec2(x*6.+s*5.,y*3.+t*.25));float pulse=.6+.4*sin(t*1.7+n*9.);
  float I=e*(.35+.9*n*pulse);if(I<.004)discard;col=ramp(clamp(I*.75,0.,.8))*I*.9;
 }else{float r=length(vQ);if(r>1.)discard;col=vec3(1.,.6,.2)*vD.y*(exp(-r*r*12.)*2.+exp(-r*r*3.)*.3);}
 col*=uBright;if(max(col.r,max(col.g,col.b))<.003)discard;o=vec4(col,0.);}`;
    interface Model {
        readonly objects: ModelObject[];
        readonly materials: Record<string, Material>;
    }
    interface WalkContext {
        readonly mat?: Material;
        readonly map?: 'texture' | 'opacityMap';
        readonly obj?: ModelObject;
    }

    function parse3ds(ab: ArrayBuffer): Model {
        const dv = new DataView(ab);
        const bytes = new Uint8Array(ab);
        const objects: ModelObject[] = [];
        const materials: Record<string, Material> = {};
        const str = (o: number): [string, number] => {
            let e = o;
            while (e < bytes.length && bytes[e]) e++;
            return [String.fromCharCode(...bytes.subarray(o, e)), e + 1];
        };
        const walk = (start: number, end: number, ctx: WalkContext | null): void => {
            let p = start;
            while (p + 6 <= end) {
                const id = dv.getUint16(p, true);
                const len = dv.getUint32(p + 2, true);
                const b = p + 6;
                if (len < 6 || p + len > end) break;
                if (id === 0x4d4d || id === 0x3d3d || id === 0x4100) walk(b, p + len, ctx);
                else if (id === 0xafff) {
                    const m: Material = { name: '', texture: null, opacityMap: null };
                    walk(b, p + len, { mat: m });
                    materials[m.name] = m;
                } else if (id === 0xa000 && ctx?.mat) ctx.mat.name = str(b)[0];
                else if (id === 0xa200 || id === 0xa210) walk(b, p + len, { ...ctx, map: id === 0xa200 ? 'texture' : 'opacityMap' });
                else if (id === 0xa300 && ctx?.mat && ctx.map) ctx.mat[ctx.map] = str(b)[0];
                else if (id === 0x4000) {
                    const [n, after] = str(b);
                    const o: ModelObject = { name: n, v: null, f: null, uv: null, groups: [] };
                    objects.push(o);
                    walk(after, p + len, { obj: o });
                } else if (id === 0x4110 && ctx?.obj) {
                    const n = dv.getUint16(b, true);
                    const v = new Float32Array(n * 3);
                    for (let i = 0; i < n * 3; i++) v[i] = dv.getFloat32(b + 2 + i * 4, true);
                    ctx.obj.v = v;
                } else if (id === 0x4140 && ctx?.obj) {
                    const n = dv.getUint16(b, true);
                    const t = new Float32Array(n * 2);
                    for (let i = 0; i < n * 2; i++) t[i] = dv.getFloat32(b + 2 + i * 4, true);
                    ctx.obj.uv = t;
                } else if (id === 0x4120 && ctx?.obj) {
                    const n = dv.getUint16(b, true);
                    const f = new Uint16Array(n * 3);
                    for (let i = 0; i < n; i++) for (let k = 0; k < 3; k++) f[i * 3 + k] = dv.getUint16(b + 2 + i * 8 + k * 2, true);
                    ctx.obj.f = f;
                    let q = b + 2 + n * 8;
                    while (q + 6 <= p + len) {
                        const sid = dv.getUint16(q, true);
                        const slen = dv.getUint32(q + 2, true);
                        if (sid === 0x4130) {
                            const [mn, a] = str(q + 6);
                            const c = dv.getUint16(a, true);
                            const faces = new Array<number>(c);
                            for (let i = 0; i < c; i++) faces[i] = dv.getUint16(a + 2 + i * 2, true);
                            ctx.obj.groups.push({ material: mn, faces });
                        }
                        if (slen < 6) break;
                        q += slen;
                    }
                }
                p += len;
            }
        };
        walk(0, ab.byteLength, null);
        return { objects, materials };
    }

    type Keep = (name: string, centre: number[], normal: number[], zTop: number) => boolean;

    // The chosen objects as triangle lists, one batch per object and material; picture coordinates flipped to the picture's own rows.
    function batchesOf(model: Model, names: readonly string[], fileOf: (pic: string) => string, keep?: Keep): KaspLobbyBatch[] {
        const out: KaspLobbyBatch[] = [];
        for (const o of model.objects) {
            const ov = o.v;
            const of = o.f;
            if (!names.includes(o.name) || of === null || ov === null) continue;
            for (const g0 of o.groups) {
                const g = keep
                    ? {
                          ...g0,
                          faces: g0.faces.filter((f) => {
                              const P = [0, 1, 2].map((k) => [ov[of[f * 3 + k] * 3], ov[of[f * 3 + k] * 3 + 1], ov[of[f * 3 + k] * 3 + 2]]);
                              const c = [0, 1, 2].map((a) => (P[0][a] + P[1][a] + P[2][a]) / 3);
                              const e1 = P[1].map((v, a) => v - P[0][a]);
                              const e2 = P[2].map((v, a) => v - P[0][a]);
                              const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
                              const nl = Math.hypot(...n) || 1;
                              return keep(o.name, c, n.map((v) => v / nl), Math.max(P[0][2], P[1][2], P[2][2]));
                          }),
                      }
                    : g0;
                const m = model.materials[g.material];
                if (m === undefined || !m.texture || !g.faces.length) continue;
                const pos = new Float32Array(g.faces.length * 9);
                const uv = new Float32Array(g.faces.length * 6);
                const ouv = o.uv;
                g.faces.forEach((f, n) => {
                    for (let k = 0; k < 3; k++) {
                        const i = of[f * 3 + k];
                        pos[n * 9 + k * 3] = ov[i * 3];
                        pos[n * 9 + k * 3 + 1] = ov[i * 3 + 1];
                        pos[n * 9 + k * 3 + 2] = ov[i * 3 + 2];
                        uv[n * 6 + k * 2] = ouv ? ouv[i * 2] : 0;
                        uv[n * 6 + k * 2 + 1] = ouv ? 1 - ouv[i * 2 + 1] : 0;
                    }
                });
                const pic = m.texture.toLowerCase().replace(/\.(png|jpg|tga)$/, '.webp');
                // 2 = see-through (light rays, glows, mist), 1 = cut out (tree outlines), 0 = solid
                out.push({
                    name: o.name,
                    pic,
                    url: fileOf(pic),
                    pos,
                    uv,
                    mode: /^(transp|glow|light)/i.test(o.name) || /^bl\./.test(pic) ? 2 : m.opacityMap ? 1 : 0,
                });
            }
        }
        return out;
    }

    // Each model file and each picture is downloaded and read only once and shared.
    const modelCache = new Map<string, Promise<Model>>();
    const picCache = new Map<string, Promise<ImageBitmap>>();
    function sharedModel(url: string): Promise<Model> {
        let pr = modelCache.get(url);
        if (pr === undefined) {
            pr = window.fetch(url).then(async (res) => {
                if (!res.ok) throw new Error('model ' + res.status);
                return parse3ds(await res.arrayBuffer());
            });
            modelCache.set(url, pr);
            pr.catch(() => modelCache.delete(url));
        }
        return pr;
    }
    function sharedPic(url: string): Promise<ImageBitmap> {
        let pr = picCache.get(url);
        if (pr === undefined) {
            pr = window.fetch(url).then(async (r) => {
                if (!r.ok) throw new Error('picture ' + r.status);
                return createImageBitmap(await r.blob(), { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
            });
            picCache.set(url, pr);
            pr.catch(() => picCache.delete(url));
        }
        return pr;
    }
    async function pictures(batches: readonly KaspLobbyBatch[]): Promise<Map<string, ImageBitmap>> {
        const wanted = [...new Map(batches.map((b) => [b.pic, b.url])).entries()];
        const got = await Promise.all(wanted.map(([, url]) => sharedPic(url)));
        const pics = new Map<string, ImageBitmap>();
        wanted.forEach(([pic], i) => pics.set(pic, got[i]));
        return pics;
    }

    // The game's own hangar, read once from its folder: the room and the floor (the floor blend draws the floor again), and the
    // road's flat ground just outside (its upward faces under 160, as the probe's ensureRoad), seen from above for the blend.
    async function loadStandard(folder: string): Promise<KaspLobbyStandard> {
        const modelUrl = folder + '/object.3ds';
        const fileOf = (pic: string): string => folder + '/' + pic;
        const model = await sharedModel(modelUrl);
        const stdBatches = batchesOf(model, ['room0', 'floor0'], fileOf);
        const groundBatches = batchesOf(model, ['bg0'], fileOf, (_name, _c, n, zTop) => zTop < 160 && Math.abs(n[2]) > 0.6).filter((b) => b.mode !== 2);
        const [stdPics, groundPics] = await Promise.all([pictures(stdBatches), pictures(batchesOf(model, ['bg0'], fileOf))]);
        return {
            lamps: findLamps(model),
            std: { key: 'standard', batches: stdBatches, pics: stdPics },
            ground: { key: 'standard:ground', batches: groundBatches, pics: groundPics, back: 600, fwd: 6200 },
        };
    }

    // ---- the night pictures (26f2), the probe's makeNightPictures ----
    // The hangar's wall and floor pictures with their painted sunlight taken out, kept as a factor per pixel (night / day, 255 =
    // unchanged) that stage 0b multiplies the game's walls and floor by. Made once in the page from the game's own pictures (as the
    // game got them, so the floor is the cleaned one where the look has it). The wall: the sunlit places (bright and warm over cooler
    // shade) brought to the colour of the plain wall's shade round them, bricks kept orange, detail kept (nightPicture, since
    // 2026-11-22 no longer the probe's: that one left dark spots under the screen stand); the floor: its sunlight removed and its light
    // flattened by hangar_files.ts's own two steps (removeSun, flattenPicture: the same code and numbers as the probe's).
    interface NightOptions {
        readonly lum: readonly [number, number];
        readonly warm: readonly [number, number];
        readonly radius: number;
        readonly sun?: true;
        readonly flatten?: true;
    }
    const NIGHT_OPTIONS: Readonly<Record<string, NightOptions>> = {
        'gar1.webp': { lum: [0.45, 0.75], warm: [0.05, 0.18], radius: 14 },
        'flr1.webp': { lum: [0.26, 0.48], warm: [-0.04, 0.07], radius: 14, sun: true, flatten: true },
    };

    function nightPicture(px: Uint8ClampedArray, W: number, H: number, o: NightOptions): void {
        const sm = (a: number, b: number, x: number): number => {
            const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
            return t * t * (3 - 2 * t);
        };
        // Two grids: Q (4 x 4 pixels) for the sun's outline and the light, Q2 (2 x 2) for the fine match at the sun's soft edges.
        const Q = 4;
        const w = Math.ceil(W / Q);
        const h = Math.ceil(H / Q);
        const Q2 = 2;
        const w2 = Math.ceil(W / Q2);
        const h2 = Math.ceil(H / Q2);
        const bg = [px[(W - 1) * 4], px[(W - 1) * 4 + 1], px[(W - 1) * 4 + 2]];
        const mFull = new Float32Array(W * H);
        const cells = (): Float32Array => new Float32Array(w * h);
        const three = (): [Float32Array, Float32Array, Float32Array] => [cells(), cells(), cells()];
        const Lm = cells();
        const Ln = cells();
        // The light is read on the plain wall only (owner 2026-11-22): pixels that are not dark (the stand's bars, the cables, the
        // painted shadows, the dark strip along the wall's foot) and not strongly coloured (the bricks, rust). Shade samples: plain
        // pixels with no sun of their own; sun samples: plain pixels in full sun. Reading the light on everything round a sun spot
        // took in those dark things and painted the spot nearly black; reading it like with like also keeps the bricks orange.
        const shN = cells();
        const suN = cells();
        const PS = three();
        const PU = three();
        const P2 = new Float32Array(w2 * h2);
        const N2 = [new Float32Array(w2 * h2), new Float32Array(w2 * h2), new Float32Array(w2 * h2)];
        // Bricks (owner 2026-11-22: a brighter orange ring was left round the dark block beside the stand): a brick in full sun is
        // bright orange, which the brightness test above reads as only half sun. Next to a sun spot a brick's sun is read on its
        // red instead, between the bricks in shade and the bricks in sun round it (both must be there, so an orange machine part
        // elsewhere on the picture is never taken for a sunlit brick). Here: the red of each, summed per cell.
        const brick = (r: number, g: number, b: number): number => (1 - sm(0.7, 0.85, g / Math.max(r, 1e-3))) * sm(0.15, 0.3, r - b);
        const bS = cells();
        const bSr = cells();
        const bU = cells();
        const bUr = cells();
        for (let y = 0; y < H; y++)
            for (let x = 0; x < W; x++) {
                const i = (y * W + x) * 4;
                const r = px[i] / 255;
                const g = px[i + 1] / 255;
                const b = px[i + 2] / 255;
                const content = Math.abs(px[i] - bg[0]) + Math.abs(px[i + 1] - bg[1]) + Math.abs(px[i + 2] - bg[2]) > 10 ? 1 : 0;
                const lum = 0.3 * r + 0.59 * g + 0.11 * b;
                const m = content * sm(o.lum[0], o.lum[1], lum) * sm(o.warm[0], o.warm[1], r - b);
                mFull[y * W + x] = m;
                const j = ((y / Q) | 0) * w + ((x / Q) | 0);
                Lm[j] += m;
                Ln[j] += content;
                const cb = content * brick(r, g, b);
                if (cb > 0) {
                    const shade = cb * (1 - sm(0.45, 0.6, r));
                    const sun = cb * sm(0.8, 0.9, r);
                    bS[j] += shade;
                    bSr[j] += r * shade;
                    bU[j] += sun;
                    bUr[j] += r * sun;
                }
                const p = content * sm(0.28, 0.36, lum) * sm(0.7, 0.85, g / Math.max(r, 1e-3));
                if (p === 0) continue;
                const sh = p * (1 - m) * (1 - m);
                const su = p * m * m;
                shN[j] += sh;
                suN[j] += su;
                PS[0][j] += r * sh;
                PS[1][j] += g * sh;
                PS[2][j] += b * sh;
                PU[0][j] += r * su;
                PU[1][j] += g * su;
                PU[2][j] += b * su;
                const j2 = ((y / Q2) | 0) * w2 + ((x / Q2) | 0);
                P2[j2] += p;
                N2[0][j2] += p / Math.max(r, 1 / 255);
                N2[1][j2] += p / Math.max(g, 1 / 255);
                N2[2][j2] += p / Math.max(b, 1 / 255);
            }
        for (let j = 0; j < w * h; j++) {
            for (let c = 0; c < 3; c++) {
                PS[c][j] /= shN[j] || 1;
                PU[c][j] /= suN[j] || 1;
            }
            shN[j] /= Q * Q;
            suN[j] /= Q * Q;
            Lm[j] /= Q * Q;
            Ln[j] /= Q * Q;
        }
        const blur = (src: Float32Array, gw: number, gh: number, r: number): Float32Array => {
            const tmp = new Float32Array(gw * gh);
            const out = new Float32Array(gw * gh);
            for (let y = 0; y < gh; y++) {
                let s = 0;
                for (let x = -r; x <= r; x++) s += src[y * gw + Math.min(gw - 1, Math.max(0, x))];
                for (let x = 0; x < gw; x++) {
                    tmp[y * gw + x] = s / (2 * r + 1);
                    s += src[y * gw + Math.min(gw - 1, x + r + 1)] - src[y * gw + Math.max(0, x - r)];
                }
            }
            for (let x = 0; x < gw; x++) {
                let s = 0;
                for (let y = -r; y <= r; y++) s += tmp[Math.min(gh - 1, Math.max(0, y)) * gw + x];
                for (let y = 0; y < gh; y++) {
                    out[y * gw + x] = s / (2 * r + 1);
                    s += tmp[Math.min(gh - 1, y + r + 1) * gw + x] - tmp[Math.max(0, y - r) * gw + x];
                }
            }
            return out;
        };
        const soft = (a: Float32Array, r: number): Float32Array => blur(blur(a, w, h, r), w, h, r);
        const mb = soft(Lm, 2);
        const m = cells();
        for (let j = 0; j < w * h; j++) m[j] = Math.min(1, Math.max(Lm[j], mb[j] * 2.2)) * (Ln[j] > 0.2 ? 1 : 0);
        const wShade = cells();
        for (let j = 0; j < w * h; j++) wShade[j] = (1 - m[j]) * shN[j];
        const scale = (r: number): { ch: Array<[Float32Array, Float32Array]>; ns: Float32Array; nu: Float32Array } => {
            const ch = [0, 1, 2].map((c): [Float32Array, Float32Array] => {
                const a = cells();
                const u = cells();
                for (let j = 0; j < w * h; j++) {
                    a[j] = PS[c][j] * wShade[j];
                    u[j] = PU[c][j] * suN[j];
                }
                return [soft(a, r), soft(u, r)];
            });
            return { ch, ns: soft(wShade, r), nu: soft(suN, r) };
        };
        const near = scale(o.radius);
        const far = scale(o.radius * 4);
        // the light over the whole picture, for a spot with no plain wall near it (a wooden plank, a lamp)
        const whole = [0, 1, 2].map((c) => {
            let s = 0;
            let ws = 0;
            let u = 0;
            let wu = 0;
            for (let j = 0; j < w * h; j++) {
                s += PS[c][j] * wShade[j];
                ws += wShade[j];
                u += PU[c][j] * suN[j];
                wu += suN[j];
            }
            return ws > 0 && wu > 0 && u > 0 ? Math.min(1, s / ws / (u / wu)) : 1;
        });
        // per cell: the light's ratio (shade / sun), the plain wall's shade colour, and whether that colour is known
        const LUM = [0.3, 0.59, 0.11];
        const ratio = three();
        const shadeCol = three();
        const known = cells();
        for (let j = 0; j < w * h; j++) {
            const pick = near.ns[j] > 0.06 ? near : far;
            const ns = pick.ns[j];
            const nu = pick.nu[j];
            const shade = [0, 0, 0];
            const sun = [0, 0, 0];
            let lumS = 0;
            let lumU = 0;
            for (let c = 0; c < 3; c++) {
                shade[c] = ns > 1e-4 ? pick.ch[c][0][j] / ns : 0;
                sun[c] = nu > 1e-4 ? pick.ch[c][1][j] / nu : 0;
                lumS += LUM[c] * shade[c];
                lumU += LUM[c] * sun[c];
            }
            const both = ns > 0.01 && nu > 0.01;
            known[j] = both && lumU > lumS + 0.05 ? 1 : 0;
            for (let c = 0; c < 3; c++) {
                ratio[c][j] = both && sun[c] > 1e-3 ? Math.max(0.15, Math.min(1, shade[c] / sun[c])) : whole[c];
                shadeCol[c][j] = known[j] * shade[c];
            }
        }
        const at = (a: Float32Array, gw: number, gh: number, fx: number, fy: number): number => {
            const x0 = Math.max(0, Math.min(gw - 1, Math.floor(fx)));
            const y0 = Math.max(0, Math.min(gh - 1, Math.floor(fy)));
            const x1 = Math.min(gw - 1, x0 + 1);
            const y1 = Math.min(gh - 1, y0 + 1);
            const tx = Math.max(0, Math.min(1, fx - x0));
            const ty = Math.max(0, Math.min(1, fy - y0));
            return (a[y0 * gw + x0] * (1 - tx) + a[y0 * gw + x1] * tx) * (1 - ty) + (a[y1 * gw + x0] * (1 - tx) + a[y1 * gw + x1] * tx) * ty;
        };
        // The fine match (2 x 2 cells): the gain that brings the plain wall exactly to the plain shade colour beside it, smoothed so
        // the wall's own detail stays. It follows the sun's soft edges, where one light ratio for the whole spot left light outlines.
        // Trusted where plain wall is near and its shade colour is known; elsewhere (inside a wide brick patch) the light ratio alone.
        const plain2 = new Float32Array(w2 * h2);
        const known2 = new Float32Array(w2 * h2);
        for (let y2 = 0; y2 < h2; y2++)
            for (let x2 = 0; x2 < w2; x2++) {
                const j2 = y2 * w2 + x2;
                const fx = (x2 * Q2 + Q2 / 2) / Q - 0.5;
                const fy = (y2 * Q2 + Q2 / 2) / Q - 0.5;
                for (let c = 0; c < 3; c++) N2[c][j2] = (N2[c][j2] * at(shadeCol[c], w, h, fx, fy)) / (Q2 * Q2);
                plain2[j2] = P2[j2] / (Q2 * Q2);
                known2[j2] = at(known, w, h, fx, fy);
            }
        const soft2 = (a: Float32Array): Float32Array => blur(blur(a, w2, h2, 2), w2, h2, 2);
        const plainNear = soft2(plain2);
        const gain = N2.map((n) => {
            const s = soft2(n);
            for (let j2 = 0; j2 < w2 * h2; j2++) s[j2] = Math.min(1, s[j2] / Math.max(plainNear[j2], 1e-6));
            return s;
        });
        const trust = new Float32Array(w2 * h2);
        for (let j2 = 0; j2 < w2 * h2; j2++) trust[j2] = Math.min(1, plainNear[j2] / 0.3) * known2[j2];
        // the bricks' red in shade and in sun round each cell, known where both are near and clearly apart
        const sS = soft(bS, o.radius);
        const sU = soft(bU, o.radius);
        const redS = soft(bSr, o.radius);
        const redU = soft(bUr, o.radius);
        const knownB = cells();
        for (let j = 0; j < w * h; j++) {
            redS[j] /= Math.max(sS[j], 1e-6);
            redU[j] /= Math.max(sU[j], 1e-6);
            knownB[j] = sS[j] / (Q * Q) > 0.02 && sU[j] / (Q * Q) > 0.02 && redU[j] > redS[j] + 0.3 ? 1 : 0;
        }
        for (let y = 0; y < H; y++)
            for (let x = 0; x < W; x++) {
                const fx = (x + 0.5) / Q - 0.5;
                const fy = (y + 0.5) / Q - 0.5;
                const i = (y * W + x) * 4;
                const kb = at(knownB, w, h, fx, fy);
                // a brick's sun read on its red (kept in mFull, so the last touch below sees it too)
                let bSun = 0;
                if (kb > 0) {
                    const r = px[i] / 255;
                    const rs = at(redS, w, h, fx, fy);
                    const sun = Math.max(0, Math.min(1, (r - rs) / Math.max(at(redU, w, h, fx, fy) - rs, 0.05)));
                    bSun = kb * brick(r, px[i + 1] / 255, px[i + 2] / 255) * sun;
                    if (bSun > mFull[y * W + x]) mFull[y * W + x] = bSun;
                }
                const k = Math.max(mFull[y * W + x], at(m, w, h, fx, fy));
                if (k < 0.01) continue;
                const gx = (x + 0.5) / Q2 - 0.5;
                const gy = (y + 0.5) / Q2 - 0.5;
                const mix = at(trust, w2, h2, gx, gy) * Math.min(1, (k - 0.01) * 4);
                for (let c = 0; c < 3; c++) {
                    const R = at(ratio[c], w, h, fx, fy);
                    let light = 1 - k + k * R;
                    // a half-lit brick: its red grows with the light, so taking the sun out is a division (the straight line above
                    // under-darkens it and leaves a lighter ring where the sun faded)
                    if (bSun > 0) light = Math.min(light, R / (R + bSun * (1 - R)));
                    px[i + c] = Math.round(px[i + c] * ((1 - mix) * light + mix * at(gain[c], w2, h2, gx, gy)));
                }
            }
        // The last touch inside the old sun spots (owner 2026-11-22: no light or yellowish places at all). Everything is matched to
        // the wall that never had sun round it (the game's own pixels there, untouched): the plaster takes the never-lit plaster's
        // colour (its own light and dark detail kept, never more than a little lighter), and a brick gets the colour balance and
        // brightness of the never-lit bricks (each colour scaled, so its pattern and the mortar stay). The sun's warm light left
        // the cleaned places short of blue, which the cool night light shows as a yellow tint; the never-lit wall has no such cast.
        const grey = (r: number, g: number): number => sm(0.7, 0.85, g / Math.max(r, 1e-3));
        // per Q cell: never-lit plaster (nP), never-lit bricks (nB, painted shadows left out: they are darker than the wall's
        // shade) and cleaned bricks (cB), each colour summed with its weight
        const nPw = cells();
        const nP = three();
        const nBw = cells();
        const nB = three();
        const cBw = cells();
        const cB = three();
        const kAt = (x: number, y: number): number => Math.max(mFull[y * W + x], at(m, w, h, (x + 0.5) / Q - 0.5, (y + 0.5) / Q - 0.5));
        for (let y = 0; y < H; y++)
            for (let x = 0; x < W; x++) {
                const i = (y * W + x) * 4;
                const r = px[i] / 255;
                const g = px[i + 1] / 255;
                const b = px[i + 2] / 255;
                const lum = 0.3 * r + 0.59 * g + 0.11 * b;
                const gr = grey(r, g);
                const p = sm(0.28, 0.36, lum) * gr;
                const q = (1 - gr) * sm(0.1, 0.15, lum);
                if (p === 0 && q === 0) continue;
                const j = ((y / Q) | 0) * w + ((x / Q) | 0);
                const k = kAt(x, y);
                const col = [r, g, b];
                if (k < 0.01) {
                    const n = q * sm(0.17, 0.2, lum);
                    nPw[j] += p;
                    nBw[j] += n;
                    for (let c = 0; c < 3; c++) {
                        nP[c][j] += col[c] * p;
                        nB[c][j] += col[c] * n;
                    }
                } else {
                    const cw = q * Math.min(1, (k - 0.01) * 4);
                    cBw[j] += cw;
                    for (let c = 0; c < 3; c++) cB[c][j] += col[c] * cw;
                }
            }
        // a mean colour per cell: read near (o.radius) where enough of it is near, else far out (a sun spot can be wide); smooth,
        // so the change has no edge of its own
        const meanOf = (sums: Float32Array[], weight: Float32Array, min: number, farOnly = false): { col: Float32Array[]; ok: Float32Array } => {
            const nearW = soft(weight, o.radius);
            const farW = soft(weight, o.radius * 4);
            const nearC = sums.map((s) => soft(s, o.radius));
            const farC = sums.map((s) => soft(s, o.radius * 4));
            const col = [cells(), cells(), cells()];
            const ok = cells();
            for (let j = 0; j < w * h; j++) {
                const useNear = !farOnly && nearW[j] / (Q * Q) > min;
                const wj = useNear ? nearW[j] : farW[j];
                ok[j] = wj / (Q * Q) > min * 0.1 ? 1 : 0;
                for (let c = 0; c < 3; c++) col[c][j] = ok[j] ? (useNear ? nearC[c][j] : farC[c][j]) / wj : 0;
            }
            return { col, ok };
        };
        const plainRef = meanOf(nP, nPw, 0.02);
        // the bricks over one wide round each, the same for both, so the correction is even across a sun spot
        const brickRef = meanOf(nB, nBw, 0.02, true);
        const brickNow = meanOf(cB, cBw, 0.02, true);
        // the never-lit bricks close by, for the yellow test below (their colour changes across the wall)
        const brickNear = meanOf(nB, nBw, 0.02);
        // a brick's gain per colour (never-lit / cleaned): the colour balance always, the brightness only down
        const brickGain = three();
        for (let j = 0; j < w * h; j++) {
            if (!brickRef.ok[j] || !brickNow.ok[j]) {
                for (let c = 0; c < 3; c++) brickGain[c][j] = 1;
                continue;
            }
            const L = (a: Float32Array[]): number => 0.3 * a[0][j] + 0.59 * a[1][j] + 0.11 * a[2][j];
            const down = Math.max(1, L(brickRef.col) / Math.max(L(brickNow.col), 1e-3));
            for (let c = 0; c < 3; c++) brickGain[c][j] = brickRef.col[c][j] / Math.max(brickNow.col[c][j], 1e-3) / down;
        }
        const knee = (v: number, cap: number): number => (v > cap ? cap + (v - cap) * 0.25 : v);
        for (let y = 0; y < H; y++)
            for (let x = 0; x < W; x++) {
                const k = kAt(x, y);
                if (k < 0.01) continue;
                const region = Math.min(1, (k - 0.01) * 4);
                const fx = (x + 0.5) / Q - 0.5;
                const fy = (y + 0.5) / Q - 0.5;
                const i = (y * W + x) * 4;
                const r = px[i] / 255;
                const g = px[i + 1] / 255;
                const b = px[i + 2] / 255;
                const lum = 0.3 * r + 0.59 * g + 0.11 * b;
                const gr = grey(r, g);
                const ref = [at(plainRef.col[0], w, h, fx, fy), at(plainRef.col[1], w, h, fx, fy), at(plainRef.col[2], w, h, fx, fy)];
                const LL = 0.3 * ref[0] + 0.59 * ref[1] + 0.11 * ref[2];
                const wp = LL > 0.05 ? region * gr * at(plainRef.ok, w, h, fx, fy) : 0;
                const wb = region * (1 - gr);
                const lumP = knee(lum, LL * 1.03);
                const own = [r, g, b];
                const v = [0, 0, 0];
                for (let c = 0; c < 3; c++) {
                    const plaster = (ref[c] * lumP) / Math.max(LL, 1e-3);
                    const bricked = own[c] * at(brickGain[c], w, h, fx, fy);
                    v[c] = own[c] * (1 - wp - wb) + plaster * wp + bricked * wb;
                }
                // No pixel yellower than the never-lit wall of its kind next to it: the excess yellow ((red + green) / 2 over blue,
                // for its brightness) is taken out by raising the blue and lowering red and green a little, its brightness kept.
                const yel = (c3: readonly number[]): number => ((c3[0] + c3[1]) / 2 - c3[2]) / Math.max(0.3 * c3[0] + 0.59 * c3[1] + 0.11 * c3[2], 1e-3);
                const refB = [at(brickNear.col[0], w, h, fx, fy), at(brickNear.col[1], w, h, fx, fy), at(brickNear.col[2], w, h, fx, fy)];
                const okP = LL > 0.05 && at(plainRef.ok, w, h, fx, fy) > 0.5;
                const okB = at(brickNear.ok, w, h, fx, fy) > 0.5;
                if (okP || okB) {
                    const yRef = okP && okB ? gr * yel(ref) + (1 - gr) * yel(refB) : okP ? yel(ref) : yel(refB);
                    const vL = 0.3 * v[0] + 0.59 * v[1] + 0.11 * v[2];
                    const extra = yel(v) - yRef;
                    if (extra > 0) {
                        const s = 0.11 / 0.89;
                        const t = (region * extra * vL) / (1 + s);
                        v[0] -= t * s;
                        v[1] -= t * s;
                        v[2] += t;
                    }
                }
                for (let c = 0; c < 3; c++) px[i + c] = Math.round(255 * Math.max(0, v[c]));
            }
    }

    // The factor pictures, one per picture with options; a picture the floor steps are missing for is left out.
    async function nightPictures(asset: KaspLobbyAsset): Promise<ReadonlyMap<string, ImageBitmap>> {
        const out = new Map<string, ImageBitmap>();
        const floorSteps = window.__kaspHangarPictures;
        for (const [pic, bmp] of asset.pics) {
            const o = NIGHT_OPTIONS[pic];
            if (o === undefined) continue;
            if ((o.sun || o.flatten) && floorSteps === undefined) continue;
            const make = async (): Promise<Blob | null> => {
                const c = new OffscreenCanvas(bmp.width, bmp.height);
                const g = c.getContext('2d', { willReadFrequently: true });
                if (g === null) return null;
                g.drawImage(bmp, 0, 0);
                const img = g.getImageData(0, 0, bmp.width, bmp.height);
                const day = new Uint8ClampedArray(img.data);
                if (o.sun) floorSteps?.removeSun(img.data, bmp.width, bmp.height);
                else nightPicture(img.data, bmp.width, bmp.height, o);
                if (o.flatten) floorSteps?.flattenPicture(img.data, bmp.width, bmp.height);
                // kept as the factor night / day (255 = unchanged); a factor can only dim: where the night picture is brighter than
                // the game's in one colour, all three are scaled down together, so the colour stays the night picture's
                const px = img.data;
                for (let i = 0; i < px.length; i += 4) {
                    const s = Math.min(1, day[i] / Math.max(px[i], 1), day[i + 1] / Math.max(px[i + 1], 1), day[i + 2] / Math.max(px[i + 2], 1));
                    for (let k = 0; k < 3; k++) px[i + k] = day[i + k] ? Math.min(255, Math.round((255 * s * px[i + k]) / day[i + k])) : 255;
                    px[i + 3] = 255;
                }
                // saved without loss (PNG), so a saved factor is the made one, byte for byte
                g.putImageData(img, 0, 0);
                await new Promise((r) => setTimeout(r, 0));
                return c.convertToBlob({ type: 'image/png' });
            };
            // made once and saved (hangar_files.ts's store); the floor's input depends on whether the floor is the cleaned one, the
            // wall's on what was changed on it (the Christmas cleaning, the banners)
            const name = `night-${pic}-${floorSteps?.floorCleaned === true ? 'clean' : 'game'}${pic === 'gar1.webp' ? (floorSteps?.wallTag ?? '') : ''}.png`;
            const blob = floorSteps === undefined ? await make() : await floorSteps.saved(name, make);
            if (blob === null) continue;
            out.set(pic, await createImageBitmap(blob, { premultiplyAlpha: 'none', colorSpaceConversion: 'none' }));
        }
        return out;
    }

    // ---- the overcast's pictures (26g1), the probe's makeLensPictures and skyGrey ----
    // The four lamp lenses under the round rail are painted into the wall picture (one spot of the 4096 x 4096 sheet, x 760-1300,
    // y 3795-3895): a factor picture, white everywhere and dark on that spot, multiplied over the wall like the night pictures
    // (1024 x 1024). Made once and saved like every made hangar picture (owner 2026-11-21: "for all of the hangar lobby textures,
    // without exception"; hangar_files.ts's store), lossless (PNG), so the saved one is the made one.
    async function lensPictures(asset: KaspLobbyAsset): Promise<ReadonlyMap<string, ImageBitmap>> {
        const room = asset.batches.find((b) => b.name === 'room0');
        if (room === undefined) return new Map();
        const Z = 1024;
        const make = async (): Promise<Blob | null> => {
            const c = new OffscreenCanvas(Z, Z);
            const g = c.getContext('2d');
            if (g === null) return null;
            g.fillStyle = '#fff';
            g.fillRect(0, 0, Z, Z);
            g.filter = 'blur(1.5px)';
            g.fillStyle = '#161616';
            g.fillRect(760 / 4 - 2, 3795 / 4 - 2, (1300 - 760) / 4 + 4, (3895 - 3795) / 4 + 4);
            return c.convertToBlob({ type: 'image/png' });
        };
        const store = window.__kaspHangarPictures;
        const blob = store === undefined ? await make() : await store.saved(`lens-${room.pic}-760-3795-1300-3895.png`, make);
        if (blob === null) return new Map();
        return new Map([[room.pic, await createImageBitmap(blob, { premultiplyAlpha: 'none', colorSpaceConversion: 'none' })]]);
    }

    // Turns the blue sky of the hangar's sky picture into a cloudy grey one (the skyline, hills and trees stay).
    interface SkyGrey {
        readonly amount: number;
        readonly contrast: number;
        readonly tint: readonly number[];
    }
    function skyGrey(d: Uint8ClampedArray, W: number, H: number, o: SkyGrey): void {
        const N = W * H;
        const ss = (a: number, b: number, x: number): number => {
            const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
            return t * t * (3 - 2 * t);
        };
        const m0 = new Float32Array(N);
        const lum = new Float32Array(N);
        for (let i = 0; i < N; i++) {
            const r = d[i * 4];
            const g = d[i * 4 + 1];
            const b = d[i * 4 + 2];
            lum[i] = (0.3 * r + 0.59 * g + 0.11 * b) / 255;
            m0[i] = ss(0.04, 0.28, (b - r) / 255) * (1 - ss(0, 0.06, (g - b) / 255));
        }
        const blur = (src: Float32Array, rad: number): Float32Array => {
            const tmp = new Float32Array(N);
            const out = new Float32Array(N);
            const w = 2 * rad + 1;
            for (let y = 0; y < H; y++) {
                let s = 0;
                const row = y * W;
                for (let x = -rad; x <= rad; x++) s += src[row + Math.min(W - 1, Math.max(0, x))];
                for (let x = 0; x < W; x++) {
                    tmp[row + x] = s / w;
                    s += src[row + Math.min(W - 1, x + rad + 1)] - src[row + Math.max(0, x - rad)];
                }
            }
            for (let x = 0; x < W; x++) {
                let s = 0;
                for (let y = -rad; y <= rad; y++) s += tmp[Math.min(H - 1, Math.max(0, y)) * W + x];
                for (let y = 0; y < H; y++) {
                    out[y * W + x] = s / w;
                    s += tmp[Math.min(H - 1, y + rad + 1) * W + x] - tmp[Math.max(0, y - rad) * W + x];
                }
            }
            return out;
        };
        const bl = blur(blur(m0, 12), 12);
        const k = 0.3 + o.contrast * 1.1;
        for (let i = 0; i < N; i++) {
            const r = d[i * 4];
            const g = d[i * 4 + 1];
            const b = d[i * 4 + 2];
            const y = Math.floor(i / W) / H;
            const warm = ss(0, 0.05, (r - b) / 255);
            const cloud = ss(0.45, 0.7, lum[i]) * (1 - warm) * ss(0.25, 0.5, bl[i]);
            const M = Math.max(m0[i], cloud) * o.amount;
            if (M < 0.002) continue;
            let f = ss(0.15, 0.95, Math.min(1, Math.max(0, (lum[i] - 0.22) / 0.7)));
            f = 0.5 + (f - 0.5) * k;
            const hz = ss(0.15, 0.72, y);
            const sc = 0.62 + 0.62 * f + 0.18 * hz;
            d[i * 4] = r + (Math.min(255, o.tint[0] * 255 * sc) - r) * M;
            d[i * 4 + 1] = g + (Math.min(255, o.tint[1] * 255 * sc) - g) * M;
            d[i * 4 + 2] = b + (Math.min(255, o.tint[2] * 255 * sc) - b) * M;
        }
    }

    // The game's sky mesh (Sky0) read from its hangar model with its picture greyed, made once and saved (hangar_files.ts's store;
    // the name holds the numbers, so other numbers make a new one).
    async function loadSky(folder: string, o: SkyGrey): Promise<KaspLobbyAsset> {
        const model = await sharedModel(folder + '/object.3ds');
        const batches = batchesOf(model, ['Sky0'], (pic) => folder + '/' + pic);
        if (batches.length === 0) throw new Error('no sky');
        const pics = await pictures(batches);
        const pic = batches[0].pic;
        const orig = pics.get(pic);
        if (orig === undefined) throw new Error('no sky picture');
        const make = async (): Promise<Blob | null> => {
            const c = new OffscreenCanvas(orig.width, orig.height);
            const g = c.getContext('2d', { willReadFrequently: true });
            if (g === null) return null;
            g.drawImage(orig, 0, 0);
            const img = g.getImageData(0, 0, orig.width, orig.height);
            skyGrey(img.data, orig.width, orig.height, o);
            g.putImageData(img, 0, 0);
            await new Promise((r) => setTimeout(r, 0));
            return c.convertToBlob({ type: 'image/png' });
        };
        const store = window.__kaspHangarPictures;
        const name = `sky-grey-${pic}-${o.amount}-${o.contrast}-${o.tint.map((x) => x.toFixed(4)).join('-')}.png`;
        const blob = store === undefined ? await make() : await store.saved(name, make);
        if (blob === null) throw new Error('sky not made');
        const grey = await createImageBitmap(blob, { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
        return { key: 'standard-sky', batches, pics: new Map([[pic, grey]]) };
    }

    // The lamps under the ring: the faces of room0 that show the lamp lens (one spot of the 4096 x 4096 wall picture), grouped; a
    // point just under each lens, where the light starts.
    function findLamps(model: Model): number[][] {
        const r = model.objects.find((o) => o.name === 'room0');
        if (r === undefined || r.uv === null || r.f === null || r.v === null) return [];
        const rf = r.f;
        const rv = r.v;
        const ruv = r.uv;
        const groups: Array<{ c: number[]; n: number }> = [];
        for (let f = 0; f < rf.length / 3; f++) {
            let u = 0;
            let v = 0;
            const c = [0, 0, 0];
            for (let k = 0; k < 3; k++) {
                const i = rf[f * 3 + k];
                u += ruv[i * 2] / 3;
                v += ruv[i * 2 + 1] / 3;
                for (let a = 0; a < 3; a++) c[a] += rv[i * 3 + a] / 3;
            }
            const px = u * 4096;
            const py = (1 - v) * 4096;
            if (px < 760 || px > 1300 || py < 3795 || py > 3895) continue;
            let g = groups.find((q) => Math.hypot(q.c[0] / q.n - c[0], q.c[1] / q.n - c[1], q.c[2] / q.n - c[2]) < 120);
            if (g === undefined) {
                g = { c: [0, 0, 0], n: 0 };
                groups.push(g);
            }
            for (let a = 0; a < 3; a++) g.c[a] += c[a];
            g.n++;
        }
        return groups
            .filter((g) => g.n >= 4)
            .slice(0, 8)
            .map((g) => [g.c[0] / g.n, g.c[1] / g.n, g.c[2] / g.n - 15]);
    }

    // ---- the GPU pass ----
    function invert4(m: Float32Array, out: Float32Array): boolean {
        const a00 = m[0], a01 = m[1], a02 = m[2], a03 = m[3], a10 = m[4], a11 = m[5], a12 = m[6], a13 = m[7];
        const a20 = m[8], a21 = m[9], a22 = m[10], a23 = m[11], a30 = m[12], a31 = m[13], a32 = m[14], a33 = m[15];
        const b00 = a00 * a11 - a01 * a10, b01 = a00 * a12 - a02 * a10, b02 = a00 * a13 - a03 * a10, b03 = a01 * a12 - a02 * a11;
        const b04 = a01 * a13 - a03 * a11, b05 = a02 * a13 - a03 * a12, b06 = a20 * a31 - a21 * a30, b07 = a20 * a32 - a22 * a30;
        const b08 = a20 * a33 - a23 * a30, b09 = a21 * a32 - a22 * a31, b10 = a21 * a33 - a23 * a31, b11 = a22 * a33 - a23 * a32;
        let det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
        if (!det || !Number.isFinite(det)) return false;
        det = 1 / det;
        out[0] = (a11 * b11 - a12 * b10 + a13 * b09) * det;
        out[1] = (a02 * b10 - a01 * b11 - a03 * b09) * det;
        out[2] = (a31 * b05 - a32 * b04 + a33 * b03) * det;
        out[3] = (a22 * b04 - a21 * b05 - a23 * b03) * det;
        out[4] = (a12 * b08 - a10 * b11 - a13 * b07) * det;
        out[5] = (a00 * b11 - a02 * b08 + a03 * b07) * det;
        out[6] = (a32 * b02 - a30 * b05 - a33 * b01) * det;
        out[7] = (a20 * b05 - a22 * b02 + a23 * b01) * det;
        out[8] = (a10 * b10 - a11 * b08 + a13 * b06) * det;
        out[9] = (a01 * b08 - a00 * b10 - a03 * b06) * det;
        out[10] = (a30 * b04 - a31 * b02 + a33 * b00) * det;
        out[11] = (a21 * b02 - a20 * b04 - a23 * b00) * det;
        out[12] = (a11 * b07 - a10 * b09 - a12 * b06) * det;
        out[13] = (a00 * b09 - a01 * b07 + a02 * b06) * det;
        out[14] = (a31 * b01 - a30 * b03 - a32 * b00) * det;
        out[15] = (a20 * b03 - a21 * b01 + a22 * b00) * det;
        return true;
    }

    interface Program {
        readonly p: WebGLProgram;
        readonly u: Readonly<Record<string, WebGLUniformLocation | null>>;
    }
    interface Piece {
        readonly vao: WebGLVertexArrayObject;
        readonly count: number;
        readonly tex: WebGLTexture;
        readonly mode: number;
        readonly name: string;
        readonly pic: string;
        // the night factor picture, uploaded the first time the piece is drawn at night
        ntex: WebGLTexture | null;
        // the lens factor picture (26g1), uploaded the first time the lenses are made dark
        ltex: WebGLTexture | null;
    }
    interface GroundMap {
        readonly tex: WebGLTexture;
        readonly box: readonly [number, number, number, number];
    }
    // The game's GL state the pass changes, saved before and put back after (the probe's save / restore).
    interface Saved {
        prog: WebGLProgram | null;
        vao: WebGLVertexArrayObject | null;
        unit: number;
        tex2: WebGLTexture | null;
        sampler2: WebGLSampler | null;
        tex: WebGLTexture | null;
        sampler: WebGLSampler | null;
        blend: boolean;
        bs: number;
        bd: number;
        bsa: number;
        bda: number;
        be: number;
        bea: number;
        depth: boolean;
        dmask: boolean;
        dfunc: number;
        caps: Array<[number, boolean]>;
        cmask: boolean[];
        viewport: Int32Array;
        draw: WebGLFramebuffer | null;
        read: WebGLFramebuffer | null;
        abuf: WebGLBuffer | null;
        po: [number, number];
    }

    function make(gl: WebGL2RenderingContext): KaspLobbyGpu {
        const UNIT = Math.max(0, Math.min(15, (gl.getParameter(gl.MAX_TEXTURE_IMAGE_UNITS) as number) - 1));
        const PANO = Math.max(0, UNIT - 1);
        const compile = (type: number, src: string): WebGLShader => {
            const s = gl.createShader(type);
            if (s === null) throw new Error('shader');
            gl.shaderSource(s, src);
            gl.compileShader(s);
            if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
                const m = gl.getShaderInfoLog(s);
                gl.deleteShader(s);
                throw new Error('lobby shader: ' + m);
            }
            return s;
        };
        const programs: WebGLProgram[] = [];
        const program = (vsSrc: string, fsSrc: string, names: readonly string[], attribs?: ReadonlyArray<readonly [number, string]>): Program => {
            const vs = compile(gl.VERTEX_SHADER, vsSrc);
            const fs = compile(gl.FRAGMENT_SHADER, fsSrc);
            const p = gl.createProgram();
            if (p === null) throw new Error('program');
            gl.attachShader(p, vs);
            gl.attachShader(p, fs);
            for (const [at, name] of attribs ?? []) gl.bindAttribLocation(p, at, name);
            gl.linkProgram(p);
            gl.deleteShader(vs);
            gl.deleteShader(fs);
            if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
                const m = gl.getProgramInfoLog(p);
                gl.deleteProgram(p);
                throw new Error('lobby program: ' + m);
            }
            programs.push(p);
            const u: Record<string, WebGLUniformLocation | null> = {};
            for (const n of names) u[n] = gl.getUniformLocation(p, n);
            return { p, u };
        };
        const uni = (pr: Program, name: string): WebGLUniformLocation | null => pr.u[name] ?? null;
        const DEPTH_U = ['uDepth', 'uInv', 'uCam', 'uViewport', 'uWall', 'uOut', 'uDoorIn', 'uDoorOut'];
        const grade = program(FULL_VS, GRADE_FS, [...DEPTH_U, 'uIn', 'uHor', 'uZen']);
        const atmos = program(FULL_VS, ATMOS_FS, [
            ...DEPTH_U, 'uTime', 'uStars', 'uFog', 'uFogStart', 'uFogHeight', 'uFogMove', 'uCover', 'uGlow', 'uGroundZ', 'uSkyZ', 'uSkyNear',
            'uSkyLow', 'uZones', 'uCloud', 'uCloudK', 'uCloudSpeed', 'uCloudCol', 'uFlash', 'uBolt', 'uFlashCol', 'uLatD', 'uBoltTex', 'uFogCol',
            'uSunDir', 'uSunCol', 'uCoverCol', 'uCoverThick', 'uSpark',
        ]);
        const lampProg = program(FULL_VS, LAMP_FS, [...DEPTH_U, 'uLamp', 'uN', 'uMode', 'uPower', 'uReach', 'uGlow', 'uCol', 'uVP']);
        const lampArray = new Float32Array(24);
        // The emergency lights (26d step 9): made on their own, so a graphics card that refuses them leaves only them out.
        let sirenProg: Program | null = null;
        let sirenState = 'made';
        let sirenDrawn = 0;
        try {
            sirenProg = program(FULL_VS, SIREN_FS, [...DEPTH_U, 'uLamp', 'uRot', 'uStb', 'uDir', 'uN', 'uReach', 'uBeamReach', 'uBeam']);
        } catch (e) {
            sirenProg = null;
            sirenState = 'refused: ' + String(e instanceof Error ? e.message : e).slice(0, 300);
        }
        const sirenLamps = new Float32Array(24);
        // The waiting room (26d step 10), made on its own the same way.
        let roomProg: Program | null = null;
        try {
            roomProg = program(FULL_VS, ROOM_FS, [...DEPTH_U, 'uBase', 'uBeamCol', 'uBeamDir', 'uDrone', 'uR', 'uFloor', 'uTop', 'uSoft', 'uAmt', 'uW', 'uRise', 'uRow', 'uDeck', 'uLogo', 'uHasLogo']);
        } catch {
            roomProg = null;
        }
        // the Tanki logo's texture for the room, made once from its picture
        let logoTex: WebGLTexture | null = null;
        let logoPic: ImageBitmap | null = null;
        const nightxProg = program(NIGHTX_VS, NIGHTX_FS, [
            'uVP', 'uCam', 'uOut', 'uLat', 'uMode', 'uStart', 'uGap', 'uH', 'uGround', 'uSize', 'uRedSize', 'uSides', 'uRed', 'uCol', 'uPostCol',
            'uFogCol', 'uBright', 'uFog', 'uFogStart', 'uHalo',
        ]);
        const ncbProg = program(NCB_VS, NCB_FS, [
            'uSlow', 'uVP', 'uCam', 'uOut', 'uLat', 'uSpan', 'uDist', 'uTime', 'uGround', 'uSize', 'uH', 'uSpeed', 'uMode', 'uLampN', 'uLamp', 'uCol',
            'uBright',
        ]);
        const ncxProg = program(FULL_VS, NCX_FS, [
            ...DEPTH_U, 'uPic', 'uHasPic', 'uTime', 'uGroundZ', 'uSkyZ', 'uSkyNear', 'uSkyLow', 'uLat', 'uMode', 'uHor', 'uZen', 'uWnAmt', 'uWnDense',
            'uWnSize', 'uWnNear', 'uWnFar', 'uWnChange', 'uMet', 'uMetT', 'uMetB', 'uMetLen', 'uMetW', 'uPlAmt', 'uPlR', 'uPlStart', 'uPlGap', 'uPlH',
            'uPlSides', 'uPlN', 'uPlCol', 'uStars',
        ]);
        const cloudxProg = program(FULL_VS, CLOUDX_FS, [...DEPTH_U, 'uTime', 'uAmt', 'uCover', 'uSize', 'uSpeed', 'uSkyZ', 'uSkyNear', 'uSkyLow', 'uCol', 'uShade', 'uPic', 'uHasPic']);
        const leafProg = program(LEAF_VS, LEAF_FS, ['uVP', 'uCam', 'uP', 'uA', 'uB', 'uSize', 'uGround', 'uFloor', 'uWall', 'uOut', 'uMode', 'uLight', 'uSun']);
        const streakProg = program(STREAK_VS, STREAK_FS, [
            'uVP', 'uCam', 'uViewport', 'uTime', 'uSpeed', 'uLen', 'uWind', 'uWidth', 'uBright', 'uOut', 'uLat', 'uRange', 'uZ', 'uColor', 'uDrift',
            'uDens', 'uCount',
        ]);
        const wetProg = program(FULL_VS, WET_FS, [
            ...DEPTH_U, 'uCol', 'uVP', 'uLat', 'uLim', 'uSky', 'uFlashCol', 'uAmt', 'uDepthW', 'uPud', 'uShine', 'uFloorZ', 'uFlash', 'uTime', 'uHasCol',
            'uRings',
        ]);
        const dripProg = program(DRIP_VS, DRIP_FS, [
            'uVP', 'uCam', 'uViewport', 'uTime', 'uG', 'uTop', 'uGround', 'uAt', 'uWidth', 'uBright', 'uWind', 'uSplash', 'uOut', 'uLat', 'uSpan', 'uColor',
        ]);
        const fogxProg = program(FULL_VS, FOGX_FS, [
            ...DEPTH_U, 'uVP', 'uLat', 'uRoomMax', 'uTime', 'uFloorZ', 'uGroundZ', 'uFar', 'uMode', 'uFlAmt', 'uFlH', 'uFlDepth', 'uFlSpeed', 'uFlLump',
            'uFlOutR', 'uFlIn', 'uFlOutC', 'uBkAmt', 'uBkSize', 'uBkSpeed', 'uBkGap', 'uBkHigh', 'uBkStart', 'uBkCol', 'uBmAmt', 'uBmPool', 'uBmDust',
            'uBmSoft', 'uBmCol', 'uBmDir', 'uDoor', 'uSkyZ', 'uSkyNear', 'uSkyLow', 'uSlAmt', 'uSlW', 'uSlO', 'uSlD', 'uSlCol', 'uCnAmt', 'uCnTan',
            'uCnReach', 'uCnDust', 'uCnCol', 'uCnLamp', 'uCnN',
        ]);
        const sunxProg = program(FULL_VS, SUNX_FS, [...DEPTH_U, 'uCol', 'uTime', 'uGroundZ', 'uSkyZ', 'uSkyNear', 'uSkyLow', 'uShAmt', 'uShH', 'uShSpeed']);
        const birdProg = program(BIRD_VS, BIRD_FS, ['uBat', 'uOne', 'uVP', 'uCam', 'uOut', 'uLat', 'uDist', 'uZ', 'uSpan', 'uTime', 'uSize', 'uSpeed', 'uHaze']);
        const clearProg = program(FULL_VS, CLEAR_FS, DEPTH_U);
        const hwxProg = program(FULL_VS, HWX_FS, [...DEPTH_U, 'uC', 'uN', 'uR', 'uAmt', 'uDim', 'uCol']);
        const glowProg = program(GLOW_VS, GLOW_FS, ['uVP', 'uCam', 'uP', 'uSize', 'uPull', 'uC0', 'uC1', 'uBright', 'uTime', 'uBlink', 'uMode']);
        const webProg = program(WEB_VS, WEB_FS, ['uVP', 'uW', 'uLat', 'uSize', 'uCol', 'uAmt', 'uTime']);
        const giftProg = program(GIFT_VS, GIFT_FS, ['uVP', 'uG', 'uGs', 'uLight']);
        const fireProg = program(FIRE_VS, FIRE_FS, ['uVP', 'uCam', 'uP', 'uQ', 'uTime', 'uPull', 'uBright']);
        const iceProg = program(ICE_VS, ICE_FS, ['uVP', 'uCam', 'uOut', 'uLat', 'uSpan', 'uTop', 'uAt', 'uLen', 'uWidth', 'uN', 'uColor', 'uTime', 'uGlint']);
        const driftProg = program(FULL_VS, DRIFT_FS, [...DEPTH_U, 'uLat', 'uLim', 'uCol', 'uAmt', 'uDepthW', 'uGust', 'uFloorZ', 'uTime', 'uSpark']);
        const flakeProg = program(FLAKE_VS, FLAKE_FS, [
            'uDrift', 'uGust', 'uLampN', 'uLampStart', 'uLampGap', 'uLampZ', 'uLampR', 'uLampGlow', 'uLampSides', 'uLampCol', 'uVP', 'uCam', 'uViewport',
            'uTime', 'uSpeed', 'uSize', 'uWind', 'uSway', 'uBright', 'uMode', 'uOut', 'uLat', 'uRange', 'uZ', 'uRoomMin', 'uRoomMax', 'uColor', 'uAlphaMul',
        ]);
        const splashProg = program(FULL_VS, SPLASH_FS, ['uDepth', 'uInv', 'uCam', 'uViewport', 'uTime', 'uRate', 'uBright', 'uWall', 'uOut', 'uColor']);
        const PIECE_ATTRIBS: ReadonlyArray<readonly [number, string]> = [[0, 'aP'], [1, 'aT']];
        const meshProg = program(MESH_VS, MESH_FS, ['uVP', 'uOff', 'uTex', 'uMode', 'uBright', 'uAmt', 'uAlpha', 'uXr', 'uXs', 'uXt'], PIECE_ATTRIBS);
        const boltProg = program(BOLT_VS, BOLT_FS, ['uVP', 'uOff', 'uBoltTex', 'uCam', 'uOut', 'uLat', 'uBolt', 'uFlash', 'uTop'], PIECE_ATTRIBS);
        const mixProg = program(MIX_VS, MIX_FS, ['uVP', 'uOff', 'uMap', 'uOut', 'uLat', 'uWall', 'uDepth', 'uAmt', 'uBox', 'uTint', 'uTintIn', 'uTone', 'uLim', 'uOutR', 'uFade', 'uInside'], PIECE_ATTRIBS);
        const aP = 0;
        const aT = 1;
        const makeVao = (): WebGLVertexArrayObject => {
            const v = gl.createVertexArray();
            if (v === null) throw new Error('vertex array');
            return v;
        };
        const makeBuffer = (): WebGLBuffer => {
            const b = gl.createBuffer();
            if (b === null) throw new Error('buffer');
            return b;
        };
        const makeTexture = (): WebGLTexture => {
            const t = gl.createTexture();
            if (t === null) throw new Error('texture');
            return t;
        };
        const vao = makeVao();
        const inv = new Float32Array(16);
        const pieceCache = new Map<string, Piece[]>();
        const picTex = new Map<ImageBitmap, WebGLTexture>();
        const pieceBufs: WebGLBuffer[] = [];
        const groundMaps = new Map<string, GroundMap>();
        let sheet: WebGLVertexArrayObject | null = null;
        let depthTex: WebGLTexture | null = null;
        // the lightning bolt's picture as a texture (26g4a): a new one each strike, the last one deleted
        let boltTex: WebGLTexture | null = null;
        let boltPic: ImageBitmap | null = null;
        let depthFbo: WebGLFramebuffer | null = null;
        let dW = 0;
        let dH = 0;
        let dFmt = 0;
        let depthReady = false;
        let depthChecked = false;
        let depthBroken = false;

        // The road beyond the floor's end: a flat sheet just over the street, showing the same ground picture.
        function roadSheet(f: KaspLobbyPassFrame): WebGLVertexArrayObject {
            if (sheet !== null) return sheet;
            const o = f.box.o;
            const l = f.box.l;
            const s0 = f.box.wall + 150;
            const s1 = f.box.wall + 6800;
            const z = f.box.groundZ + 3.5;
            const L = 1800;
            const P = (s: number, t: number): number[] => [o[0] * s + l[0] * t, o[1] * s + l[1] * t, z];
            const pts = [P(s0, -L), P(s0, L), P(s1, L), P(s0, -L), P(s1, L), P(s1, -L)];
            const vaoS = makeVao();
            gl.bindVertexArray(vaoS);
            const pb = makeBuffer();
            gl.bindBuffer(gl.ARRAY_BUFFER, pb);
            gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(pts.flat()), gl.STATIC_DRAW);
            gl.enableVertexAttribArray(aP);
            gl.vertexAttribPointer(aP, 3, gl.FLOAT, false, 0, 0);
            const tb = makeBuffer();
            gl.bindBuffer(gl.ARRAY_BUFFER, tb);
            gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(12), gl.STATIC_DRAW);
            gl.enableVertexAttribArray(aT);
            gl.vertexAttribPointer(aT, 2, gl.FLOAT, false, 0, 0);
            pieceBufs.push(pb, tb);
            gl.bindVertexArray(vao);
            sheet = vaoS;
            return vaoS;
        }

        // The ground just outside the door seen from above once (lateral x outward), for the floor blend.
        function groundMapOf(f: KaspLobbyPassFrame, ground: KaspLobbyAsset): GroundMap {
            const cached = groundMaps.get(ground.key);
            if (cached !== undefined) return cached;
            const back = ground.back ?? 0;
            const fwd = ground.fwd ?? 1500;
            const MW = 1024;
            const MH = Math.round((512 * (back + fwd)) / 1500);
            const lMin = -1800;
            const lMax = 1800;
            const sMin = f.box.wall - back;
            const sMax = f.box.wall + fwd;
            const tex = makeTexture();
            gl.activeTexture(gl.TEXTURE0 + PANO);
            gl.bindTexture(gl.TEXTURE_2D, tex);
            gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, MW, MH);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
            const rb = gl.createRenderbuffer();
            gl.bindRenderbuffer(gl.RENDERBUFFER, rb);
            gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, MW, MH);
            const fbo = gl.createFramebuffer();
            gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
            gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
            gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, rb);
            gl.drawBuffers([gl.COLOR_ATTACHMENT0]);
            gl.viewport(0, 0, MW, MH);
            gl.colorMask(true, true, true, true);
            gl.clearColor(0, 0, 0, 0);
            gl.depthMask(true);
            gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
            gl.enable(gl.DEPTH_TEST);
            gl.depthFunc(gl.LEQUAL);
            gl.disable(gl.BLEND);
            // straight down: x = across the door, y = out from the door, higher ground in front
            const o = f.box.o;
            const l = f.box.l;
            const ax = 2 / (lMax - lMin);
            const ay = 2 / (sMax - sMin);
            const top = new Float32Array([l[0] * ax, o[0] * ay, 0, 0, l[1] * ax, o[1] * ay, 0, 0, 0, 0, -1 / 1000, 0, -lMin * ax - 1, -sMin * ay - 1, 0, 1]);
            drawPieces({ ...f, vp: top }, ground, 'solid', 1, 0, 1);
            gl.bindFramebuffer(gl.FRAMEBUFFER, null);
            gl.deleteFramebuffer(fbo);
            gl.deleteRenderbuffer(rb);
            gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
            gl.colorMask(true, true, true, false);
            const m: GroundMap = { tex, box: [lMin, lMax, sMin, sMax] };
            groundMaps.set(ground.key, m);
            return m;
        }

        function uploadPicture(bmp: ImageBitmap): WebGLTexture {
            const known = picTex.get(bmp);
            if (known !== undefined) return known;
            const t = makeTexture();
            gl.activeTexture(gl.TEXTURE0 + PANO);
            gl.bindTexture(gl.TEXTURE_2D, t);
            const fields = [
                gl.UNPACK_FLIP_Y_WEBGL,
                gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL,
                gl.UNPACK_ALIGNMENT,
                gl.UNPACK_ROW_LENGTH,
                gl.UNPACK_SKIP_ROWS,
                gl.UNPACK_SKIP_PIXELS,
                gl.UNPACK_COLORSPACE_CONVERSION_WEBGL,
            ];
            const old = fields.map((x) => gl.getParameter(x) as number);
            const pbo = gl.getParameter(gl.PIXEL_UNPACK_BUFFER_BINDING) as WebGLBuffer | null;
            gl.bindBuffer(gl.PIXEL_UNPACK_BUFFER, null);
            gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
            gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
            gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
            gl.pixelStorei(gl.UNPACK_ROW_LENGTH, 0);
            gl.pixelStorei(gl.UNPACK_SKIP_ROWS, 0);
            gl.pixelStorei(gl.UNPACK_SKIP_PIXELS, 0);
            gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
            try {
                gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, bmp);
            } finally {
                fields.forEach((x, i) => gl.pixelStorei(x, old[i]));
                gl.bindBuffer(gl.PIXEL_UNPACK_BUFFER, pbo);
            }
            gl.generateMipmap(gl.TEXTURE_2D);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
            picTex.set(bmp, t);
            return t;
        }

        function piecesOf(asset: KaspLobbyAsset): Piece[] {
            const cached = pieceCache.get(asset.key);
            if (cached !== undefined) return cached;
            const list: Piece[] = [];
            for (const b of asset.batches) {
                const bmp = asset.pics.get(b.pic);
                if (bmp === undefined) continue;
                const v = makeVao();
                gl.bindVertexArray(v);
                const pb = makeBuffer();
                gl.bindBuffer(gl.ARRAY_BUFFER, pb);
                gl.bufferData(gl.ARRAY_BUFFER, b.pos, gl.STATIC_DRAW);
                gl.enableVertexAttribArray(aP);
                gl.vertexAttribPointer(aP, 3, gl.FLOAT, false, 0, 0);
                const tb = makeBuffer();
                gl.bindBuffer(gl.ARRAY_BUFFER, tb);
                gl.bufferData(gl.ARRAY_BUFFER, b.uv, gl.STATIC_DRAW);
                gl.enableVertexAttribArray(aT);
                gl.vertexAttribPointer(aT, 2, gl.FLOAT, false, 0, 0);
                pieceBufs.push(pb, tb);
                list.push({ vao: v, count: b.pos.length / 3, tex: uploadPicture(bmp), mode: b.mode, name: b.name, pic: b.pic, ntex: null, ltex: null });
            }
            gl.bindVertexArray(vao);
            pieceCache.set(asset.key, list);
            return list;
        }

        // Draws the loaded pieces; only = 'solid' (modes 0 and 1), 'sun' (every piece with a night picture, as the night multiply) or
        // 'lens' (every piece with a lens picture, the same multiply); alpha fades the pieces in (1 = fully there).
        function drawPieces(
            f: KaspLobbyPassFrame,
            asset: KaspLobbyAsset,
            only: 'solid' | 'clear' | 'sun' | 'lens' | 'glow',
            bright: number,
            amt: number,
            alpha: number,
        ): void {
            const list = piecesOf(asset);
            gl.useProgram(meshProg.p);
            gl.uniformMatrix4fv(uni(meshProg, 'uVP'), false, f.vp);
            gl.uniform3fv(uni(meshProg, 'uOff'), f.offset);
            // where a piece is moved to: a turn or a mirror (2 x 2, column by column), a size and a move (the mirrored copies of a
            // seasonal sky); every other piece stays where it was made
            gl.uniform4fv(uni(meshProg, 'uXr'), asset.xr ?? [1, 0, 0, 1]);
            gl.uniform1f(uni(meshProg, 'uXs'), asset.xs ?? 1);
            gl.uniform3fv(uni(meshProg, 'uXt'), asset.xt ?? [0, 0, 0]);
            gl.uniform1i(uni(meshProg, 'uTex'), PANO);
            gl.uniform1f(uni(meshProg, 'uBright'), bright);
            gl.uniform1f(uni(meshProg, 'uAmt'), amt);
            gl.uniform1f(uni(meshProg, 'uAlpha'), alpha);
            gl.activeTexture(gl.TEXTURE0 + PANO);
            gl.bindSampler(PANO, null);
            for (const p of list) {
                if (only === 'solid' && p.mode === 2) continue;
                if (only === 'clear' && p.mode !== 2) continue;
                if (only === 'sun') {
                    if (p.mode === 2) continue;
                    if (p.ntex === null) {
                        const n = asset.nightPics?.get(p.pic);
                        if (n === undefined) continue;
                        p.ntex = uploadPicture(n);
                    }
                }
                if (only === 'glow' && p.mode === 2) continue;
                if (only === 'lens') {
                    if (p.mode === 2) continue;
                    if (p.ltex === null) {
                        const n = asset.lensPics?.get(p.pic);
                        if (n === undefined) continue;
                        p.ltex = uploadPicture(n);
                    }
                }
                gl.uniform1i(uni(meshProg, 'uMode'), only === 'sun' || only === 'lens' ? 3 : only === 'glow' ? 4 : p.mode);
                gl.bindTexture(gl.TEXTURE_2D, only === 'sun' && p.ntex !== null ? p.ntex : only === 'lens' && p.ltex !== null ? p.ltex : p.tex);
                gl.bindVertexArray(p.vao);
                gl.drawArrays(gl.TRIANGLES, 0, p.count);
            }
            gl.bindVertexArray(vao);
            gl.activeTexture(gl.TEXTURE0 + UNIT);
        }

        const depthUniforms = (pr: Program, f: KaspLobbyPassFrame, W: number, H: number): void => {
            gl.uniform1i(uni(pr, 'uDepth'), UNIT);
            gl.uniformMatrix4fv(uni(pr, 'uInv'), false, inv);
            gl.uniform3fv(uni(pr, 'uCam'), f.cam);
            gl.uniform2f(uni(pr, 'uViewport'), W, H);
            gl.uniform1f(uni(pr, 'uWall'), f.box.wall);
            gl.uniform2f(uni(pr, 'uOut'), f.box.o[0], f.box.o[1]);
            gl.uniform1f(uni(pr, 'uDoorIn'), f.doorIn);
            gl.uniform1f(uni(pr, 'uDoorOut'), f.doorOut);
        };

        const save = (): Saved => {
            const prog = gl.getParameter(gl.CURRENT_PROGRAM) as WebGLProgram | null;
            const v = gl.getParameter(gl.VERTEX_ARRAY_BINDING) as WebGLVertexArrayObject | null;
            const unit = gl.getParameter(gl.ACTIVE_TEXTURE) as number;
            gl.activeTexture(gl.TEXTURE0 + PANO);
            const tex2 = gl.getParameter(gl.TEXTURE_BINDING_2D) as WebGLTexture | null;
            const sampler2 = gl.getParameter(gl.SAMPLER_BINDING) as WebGLSampler | null;
            gl.activeTexture(gl.TEXTURE0 + UNIT);
            return {
                prog,
                vao: v,
                unit,
                tex2,
                sampler2,
                tex: gl.getParameter(gl.TEXTURE_BINDING_2D) as WebGLTexture | null,
                sampler: gl.getParameter(gl.SAMPLER_BINDING) as WebGLSampler | null,
                blend: gl.isEnabled(gl.BLEND),
                bs: gl.getParameter(gl.BLEND_SRC_RGB) as number,
                bd: gl.getParameter(gl.BLEND_DST_RGB) as number,
                bsa: gl.getParameter(gl.BLEND_SRC_ALPHA) as number,
                bda: gl.getParameter(gl.BLEND_DST_ALPHA) as number,
                be: gl.getParameter(gl.BLEND_EQUATION_RGB) as number,
                bea: gl.getParameter(gl.BLEND_EQUATION_ALPHA) as number,
                depth: gl.isEnabled(gl.DEPTH_TEST),
                dmask: gl.getParameter(gl.DEPTH_WRITEMASK) as boolean,
                dfunc: gl.getParameter(gl.DEPTH_FUNC) as number,
                caps: [gl.CULL_FACE, gl.STENCIL_TEST, gl.SCISSOR_TEST, gl.POLYGON_OFFSET_FILL, gl.SAMPLE_ALPHA_TO_COVERAGE, gl.RASTERIZER_DISCARD].map((c): [number, boolean] => [c, gl.isEnabled(c)]),
                cmask: gl.getParameter(gl.COLOR_WRITEMASK) as boolean[],
                viewport: gl.getParameter(gl.VIEWPORT) as Int32Array,
                draw: gl.getParameter(gl.DRAW_FRAMEBUFFER_BINDING) as WebGLFramebuffer | null,
                read: gl.getParameter(gl.READ_FRAMEBUFFER_BINDING) as WebGLFramebuffer | null,
                abuf: gl.getParameter(gl.ARRAY_BUFFER_BINDING) as WebGLBuffer | null,
                po: [gl.getParameter(gl.POLYGON_OFFSET_FACTOR) as number, gl.getParameter(gl.POLYGON_OFFSET_UNITS) as number],
            };
        };
        const restore = (s: Saved): void => {
            gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, s.draw);
            gl.bindFramebuffer(gl.READ_FRAMEBUFFER, s.read);
            gl.viewport(s.viewport[0], s.viewport[1], s.viewport[2], s.viewport[3]);
            gl.activeTexture(gl.TEXTURE0 + PANO);
            gl.bindTexture(gl.TEXTURE_2D, s.tex2);
            gl.bindSampler(PANO, s.sampler2);
            gl.activeTexture(gl.TEXTURE0 + UNIT);
            gl.bindTexture(gl.TEXTURE_2D, s.tex);
            gl.bindSampler(UNIT, s.sampler);
            gl.activeTexture(s.unit);
            gl.bindVertexArray(s.vao);
            gl.useProgram(s.prog);
            if (s.blend) gl.enable(gl.BLEND);
            else gl.disable(gl.BLEND);
            gl.blendFuncSeparate(s.bs, s.bd, s.bsa, s.bda);
            gl.blendEquationSeparate(s.be, s.bea);
            if (s.depth) gl.enable(gl.DEPTH_TEST);
            else gl.disable(gl.DEPTH_TEST);
            gl.depthMask(s.dmask);
            gl.depthFunc(s.dfunc);
            for (const [c, on] of s.caps) {
                if (on) gl.enable(c);
                else gl.disable(c);
            }
            gl.colorMask(s.cmask[0], s.cmask[1], s.cmask[2], s.cmask[3]);
            gl.bindBuffer(gl.ARRAY_BUFFER, s.abuf);
            gl.polygonOffset(s.po[0], s.po[1]);
        };

        // Copies the game's depth (the canvas's own) into our texture, so the stages can read it.
        function copyDepth(W: number, H: number): boolean {
            const fmt = (gl.getParameter(gl.DEPTH_BITS) as number) > 24 ? gl.DEPTH32F_STENCIL8 : gl.DEPTH24_STENCIL8;
            if (depthTex === null || dW !== W || dH !== H || dFmt !== fmt) {
                if (depthTex !== null) gl.deleteTexture(depthTex);
                if (depthFbo !== null) gl.deleteFramebuffer(depthFbo);
                depthTex = makeTexture();
                depthFbo = gl.createFramebuffer();
                dW = W;
                dH = H;
                dFmt = fmt;
                gl.activeTexture(gl.TEXTURE0 + UNIT);
                gl.bindTexture(gl.TEXTURE_2D, depthTex);
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
                gl.texStorage2D(gl.TEXTURE_2D, 1, fmt, W, H);
                gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, depthFbo);
                gl.framebufferTexture2D(gl.DRAW_FRAMEBUFFER, gl.DEPTH_STENCIL_ATTACHMENT, gl.TEXTURE_2D, depthTex, 0);
                gl.drawBuffers([gl.NONE]);
                depthReady = gl.checkFramebufferStatus(gl.DRAW_FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
            }
            if (!depthReady) return false;
            if (!depthChecked) for (let i = 0; i < 8 && gl.getError(); i++);
            gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
            gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, depthFbo);
            gl.blitFramebuffer(0, 0, W, H, 0, 0, W, H, gl.DEPTH_BUFFER_BIT, gl.NEAREST);
            if (!depthChecked) {
                depthChecked = true;
                if (gl.getError()) depthBroken = true;
            }
            gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
            return !depthBroken;
        }

        // A copy of the picture drawn so far (the probe's copyColour), for the clouds' sky test by colour; false when it cannot be made.
        let colTex: WebGLTexture | null = null;
        let colFbo: WebGLFramebuffer | null = null;
        let cW = 0;
        let cH = 0;
        let colReady = false;
        let colChecked = false;
        let colBroken = false;
        function copyColour(W: number, H: number): boolean {
            if (colBroken) return false;
            if (colTex === null || cW !== W || cH !== H) {
                if (colTex !== null) gl.deleteTexture(colTex);
                if (colFbo !== null) gl.deleteFramebuffer(colFbo);
                colTex = makeTexture();
                colFbo = gl.createFramebuffer();
                cW = W;
                cH = H;
                gl.activeTexture(gl.TEXTURE0 + PANO);
                gl.bindTexture(gl.TEXTURE_2D, colTex);
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
                // a multisampled canvas can only be copied into the same pixel format: RGB8 when the canvas has no alpha
                const attrs = gl.getContextAttributes();
                gl.texStorage2D(gl.TEXTURE_2D, 1, attrs !== null && attrs.alpha === false ? gl.RGB8 : gl.RGBA8, W, H);
                gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, colFbo);
                gl.framebufferTexture2D(gl.DRAW_FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, colTex, 0);
                colReady = gl.checkFramebufferStatus(gl.DRAW_FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
                gl.activeTexture(gl.TEXTURE0 + UNIT);
            }
            if (!colReady) {
                colBroken = true;
                gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
                return false;
            }
            if (!colChecked) for (let i = 0; i < 8 && gl.getError(); i++);
            gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
            gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, colFbo);
            gl.blitFramebuffer(0, 0, W, H, 0, 0, W, H, gl.COLOR_BUFFER_BIT, gl.NEAREST);
            if (!colChecked) {
                colChecked = true;
                if (gl.getError()) colBroken = true;
            }
            gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
            return !colBroken;
        }

        function draw(f: KaspLobbyPassFrame): void {
            if (gl.isContextLost()) return;
            if (!invert4(f.vp, inv)) return;
            const st = save();
            try {
                const W = gl.drawingBufferWidth;
                const H = gl.drawingBufferHeight;
                for (const [c] of st.caps) gl.disable(c);
                gl.viewport(0, 0, W, H);
                const A = f.atmos;
                // 0a. the seasonal outside (26k: sky, town, road), drawn into the game's picture and depth before the depth is copied, so
                // the time colours, fog, snow and rain fall on it like on the game's own town
                if (f.outside && st.draw === null) {
                    if (!depthBroken && copyDepth(W, H)) {
                        gl.bindVertexArray(vao);
                        gl.useProgram(clearProg.p);
                        depthUniforms(clearProg, f, W, H);
                        gl.activeTexture(gl.TEXTURE0 + UNIT);
                        gl.bindTexture(gl.TEXTURE_2D, depthTex);
                        gl.bindSampler(UNIT, null);
                        gl.enable(gl.DEPTH_TEST);
                        gl.depthFunc(gl.ALWAYS);
                        gl.depthMask(true);
                        gl.colorMask(false, false, false, false);
                        gl.disable(gl.BLEND);
                        gl.drawArrays(gl.TRIANGLES, 0, 3);
                    }
                    gl.enable(gl.DEPTH_TEST);
                    gl.depthFunc(gl.LEQUAL);
                    gl.depthMask(true);
                    gl.colorMask(true, true, true, false);
                    gl.disable(gl.BLEND);
                    drawPieces(f, f.outside.asset, 'solid', f.outside.bright, 0, 1);
                    // the sky's mirrored copies past its ends (a mirror turns the faces round, so no face is skipped)
                    const copies = f.outside.asset.skyCopies ?? [];
                    if (copies.length > 0) {
                        const wasCull = gl.isEnabled(gl.CULL_FACE);
                        gl.disable(gl.CULL_FACE);
                        for (const c of copies) drawPieces(f, c, 'solid', f.outside.bright, 0, 1);
                        if (wasCull) gl.enable(gl.CULL_FACE);
                    }
                    gl.enable(gl.BLEND);
                    gl.blendEquation(gl.FUNC_ADD);
                    gl.blendFuncSeparate(gl.ONE, gl.ONE_MINUS_SRC_ALPHA, gl.ZERO, gl.ONE);
                    gl.depthMask(false);
                    drawPieces(f, f.outside.asset, 'clear', f.outside.bright, 0, 1);
                    gl.disable(gl.DEPTH_TEST);
                }
                // 0a2. the Halloween hangar's pumpkins on the floor (26k), drawn into the game's picture and depth
                if (f.hw && f.hw.pumpkins && st.draw === null) {
                    gl.enable(gl.DEPTH_TEST);
                    gl.depthFunc(gl.LEQUAL);
                    gl.depthMask(true);
                    gl.colorMask(true, true, true, false);
                    gl.disable(gl.BLEND);
                    drawPieces(f, f.hw.pumpkins.asset, 'solid', 1, 0, 1);
                    gl.enable(gl.BLEND);
                    gl.blendEquation(gl.FUNC_ADD);
                    gl.blendFuncSeparate(gl.ONE, gl.ONE_MINUS_SRC_ALPHA, gl.ZERO, gl.ONE);
                    gl.depthMask(false);
                    gl.disable(gl.DEPTH_TEST);
                }
                // 0a3. the Christmas tree and the gifts under the tree (26l), drawn into the game's picture and depth
                if (f.xm && (f.xm.tree || f.xm.gifts) && st.draw === null) {
                    gl.enable(gl.DEPTH_TEST);
                    gl.depthFunc(gl.LEQUAL);
                    gl.depthMask(true);
                    gl.colorMask(true, true, true, false);
                    gl.disable(gl.BLEND);
                    const wasCull = gl.isEnabled(gl.CULL_FACE);
                    gl.disable(gl.CULL_FACE);
                    if (f.xm.tree) drawPieces(f, f.xm.tree.asset, 'solid', 1, 0, 1);
                    if (f.xm.gifts) {
                        const G = f.xm.gifts;
                        gl.useProgram(giftProg.p);
                        gl.uniformMatrix4fv(uni(giftProg, 'uVP'), false, f.vp);
                        gl.uniform4fv(uni(giftProg, 'uG'), G.g);
                        gl.uniform4fv(uni(giftProg, 'uGs'), G.s);
                        gl.uniform3fv(uni(giftProg, 'uLight'), [1, 1, 1]);
                        gl.bindVertexArray(vao);
                        gl.drawArraysInstanced(gl.TRIANGLES, 0, 36, G.n);
                    }
                    if (wasCull) gl.enable(gl.CULL_FACE);
                    gl.enable(gl.BLEND);
                    gl.blendEquation(gl.FUNC_ADD);
                    gl.blendFuncSeparate(gl.ONE, gl.ONE_MINUS_SRC_ALPHA, gl.ZERO, gl.ONE);
                    gl.depthMask(false);
                    if (f.xm.tree) drawPieces(f, f.xm.tree.asset, 'clear', 1, 0, 1);
                    gl.blendFuncSeparate(gl.ONE, gl.ONE_MINUS_SRC_ALPHA, gl.ZERO, gl.ONE);
                    gl.disable(gl.DEPTH_TEST);
                    gl.bindVertexArray(vao);
                }
                // 0a4. the Christmas hangar's fireplace, its log pile and its rug (26l, the probe's v1.88), drawn into the game's picture
                // and depth as the tree
                if (f.fp && st.draw === null) {
                    gl.enable(gl.DEPTH_TEST);
                    gl.depthFunc(gl.LEQUAL);
                    gl.depthMask(true);
                    gl.colorMask(true, true, true, false);
                    gl.disable(gl.BLEND);
                    const wasCull = gl.isEnabled(gl.CULL_FACE);
                    gl.disable(gl.CULL_FACE);
                    for (const A of f.fp.pieces) drawPieces(f, A, 'solid', 1, 0, 1);
                    if (wasCull) gl.enable(gl.CULL_FACE);
                    gl.enable(gl.BLEND);
                    gl.blendEquation(gl.FUNC_ADD);
                    gl.blendFuncSeparate(gl.ONE, gl.ONE_MINUS_SRC_ALPHA, gl.ZERO, gl.ONE);
                    gl.depthMask(false);
                    for (const A of f.fp.pieces) drawPieces(f, A, 'clear', 1, 0, 1);
                    gl.blendFuncSeparate(gl.ONE, gl.ONE_MINUS_SRC_ALPHA, gl.ZERO, gl.ONE);
                    gl.disable(gl.DEPTH_TEST);
                    gl.bindVertexArray(vao);
                }
                const R = f.rain;
                const needDepth = !!(
                    f.xm ||
                    f.fp ||
                    (f.hw && f.hw.pumpkins) ||
                    f.sunx ||
                    f.ndx ||
                    f.ncx ||
                    (f.swx && f.swx.drift) ||
                    (R && R.splash > 0) ||
                    f.grade ||
                    A ||
                    f.lamps ||
                    (f.siren && sirenProg) ||
                    (f.room && roomProg) ||
                    f.wet ||
                    f.fogx
                );
                const depthOk = needDepth && st.draw === null && !depthBroken && copyDepth(W, H);
                gl.colorMask(true, true, true, false);
                gl.depthMask(false);
                gl.enable(gl.BLEND);
                gl.blendEquation(gl.FUNC_ADD);
                gl.bindVertexArray(vao);
                if (depthOk) {
                    gl.activeTexture(gl.TEXTURE0 + UNIT);
                    gl.bindTexture(gl.TEXTURE_2D, depthTex);
                    gl.bindSampler(UNIT, null);
                }
                gl.disable(gl.DEPTH_TEST);
                // 0b. at night: the sunlight painted in the hangar's own pictures is dimmed (multiplies the game's walls and floor, drawn
                // again on top of themselves with the game's depth, so the tank and the drone in front are untouched)
                if (f.desun && st.draw === null) {
                    gl.enable(gl.DEPTH_TEST);
                    gl.depthFunc(gl.LEQUAL);
                    gl.depthMask(false);
                    gl.enable(gl.POLYGON_OFFSET_FILL);
                    gl.polygonOffset(-1, -2);
                    gl.blendFuncSeparate(gl.ZERO, gl.SRC_COLOR, gl.ZERO, gl.ONE);
                    drawPieces(f, f.desun.asset, 'sun', 1, f.desun.amount, 1);
                    gl.disable(gl.POLYGON_OFFSET_FILL);
                    gl.disable(gl.DEPTH_TEST);
                }
                // 0b2. the four ring lamp lenses made dark (the wall picture's lens spot multiplied down; 26g1, the overcast)
                if (f.lensOff && st.draw === null) {
                    gl.enable(gl.DEPTH_TEST);
                    gl.depthFunc(gl.LEQUAL);
                    gl.depthMask(false);
                    gl.enable(gl.POLYGON_OFFSET_FILL);
                    gl.polygonOffset(-1, -3);
                    gl.blendFuncSeparate(gl.ZERO, gl.SRC_COLOR, gl.ZERO, gl.ONE);
                    drawPieces(f, f.lensOff.asset, 'lens', 1, f.lensOff.amount, 1);
                    gl.disable(gl.POLYGON_OFFSET_FILL);
                    gl.disable(gl.DEPTH_TEST);
                }
                // 0c. the grey cloudy sky (26g1): the game's own sky mesh drawn again with the greyed picture over the blue one; the town in
                // front keeps winning by the game's depth, and nothing is written to it
                if (f.sky && st.draw === null) {
                    gl.enable(gl.DEPTH_TEST);
                    gl.depthFunc(gl.LEQUAL);
                    gl.depthMask(false);
                    gl.colorMask(true, true, true, false);
                    gl.enable(gl.POLYGON_OFFSET_FILL);
                    gl.polygonOffset(-1, -4);
                    gl.disable(gl.BLEND);
                    drawPieces(f, f.sky.asset, 'solid', 1, 0, 1);
                    gl.disable(gl.POLYGON_OFFSET_FILL);
                    gl.disable(gl.DEPTH_TEST);
                    gl.enable(gl.BLEND);
                }
                // 1. the time of day / heat colour: multiply the game's picture
                if (depthOk && f.grade) {
                    gl.blendFuncSeparate(gl.ZERO, gl.SRC_COLOR, gl.ZERO, gl.ONE);
                    gl.useProgram(grade.p);
                    depthUniforms(grade, f, W, H);
                    gl.uniform3fv(uni(grade, 'uIn'), f.grade.inn);
                    gl.uniform3fv(uni(grade, 'uHor'), f.grade.hor);
                    gl.uniform3fv(uni(grade, 'uZen'), f.grade.zen);
                    gl.drawArrays(gl.TRIANGLES, 0, 3);
                }
                // 1a. the floor blend near the door: the outside's ground fading into the hangar floor
                if (f.floorMix && st.draw === null) {
                    const M = f.floorMix;
                    const gm = groundMapOf(f, M.ground);
                    // the floor's pieces loaded first: loading them uploads pictures through the slot the ground picture is bound to
                    // below (the probe loaded them after, so its first frame read the wrong picture)
                    const floorPieces = piecesOf(M.std);
                    gl.enable(gl.DEPTH_TEST);
                    gl.depthFunc(gl.LEQUAL);
                    gl.depthMask(false);
                    gl.enable(gl.POLYGON_OFFSET_FILL);
                    gl.polygonOffset(-1, -4);
                    gl.enable(gl.BLEND);
                    gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ZERO, gl.ONE);
                    gl.useProgram(mixProg.p);
                    gl.uniformMatrix4fv(uni(mixProg, 'uVP'), false, f.vp);
                    gl.uniform3fv(uni(mixProg, 'uOff'), f.offset);
                    gl.uniform1i(uni(mixProg, 'uMap'), PANO);
                    gl.uniform2f(uni(mixProg, 'uOut'), f.box.o[0], f.box.o[1]);
                    gl.uniform2f(uni(mixProg, 'uLat'), f.box.l[0], f.box.l[1]);
                    gl.uniform1f(uni(mixProg, 'uWall'), M.wall);
                    gl.uniform3fv(uni(mixProg, 'uLim'), M.lim);
                    gl.uniform1f(uni(mixProg, 'uOutR'), M.outR);
                    gl.uniform1f(uni(mixProg, 'uFade'), M.fade > 0.5 ? M.fade : -1);
                    gl.uniform1f(uni(mixProg, 'uInside'), M.inside);
                    gl.uniform1f(uni(mixProg, 'uDepth'), M.depth);
                    gl.uniform1f(uni(mixProg, 'uAmt'), M.amount);
                    gl.uniform4f(uni(mixProg, 'uBox'), gm.box[0], gm.box[1], gm.box[2], gm.box[3]);
                    const tint = f.grade ? f.grade.hor : [1, 1, 1];
                    gl.uniform3f(uni(mixProg, 'uTint'), tint[0] * M.bright, tint[1] * M.bright, tint[2] * M.bright);
                    const tin = f.grade ? f.grade.inn : [1, 1, 1];
                    gl.uniform3f(uni(mixProg, 'uTintIn'), tin[0] * M.bright, tin[1] * M.bright, tin[2] * M.bright);
                    gl.uniform1f(uni(mixProg, 'uTone'), M.tone);
                    gl.activeTexture(gl.TEXTURE0 + PANO);
                    gl.bindTexture(gl.TEXTURE_2D, gm.tex);
                    gl.bindSampler(PANO, null);
                    for (const p of floorPieces) {
                        if (p.name !== 'floor0') continue;
                        gl.bindVertexArray(p.vao);
                        gl.drawArrays(gl.TRIANGLES, 0, p.count);
                    }
                    // the road beyond the floor's end (the floor ends 258 past the wall): a flat sheet just over the street, showing the
                    // same ground picture as it is; hidden where the floor itself is
                    if (M.fade > 0.5) {
                        gl.bindVertexArray(roadSheet(f));
                        gl.drawArrays(gl.TRIANGLES, 0, 6);
                    }
                    gl.bindVertexArray(vao);
                    gl.activeTexture(gl.TEXTURE0 + UNIT);
                    gl.disable(gl.POLYGON_OFFSET_FILL);
                    gl.disable(gl.DEPTH_TEST);
                }
                // 1b. the Halloween hangar's lamp heads (night-lit lenses) over the standard ones, then their light cones, added like the
                // game's own; after the night colour, so they keep the Halloween hangar's own brightness
                if (f.fixtures && st.draw === null) {
                    gl.enable(gl.DEPTH_TEST);
                    gl.depthFunc(gl.LEQUAL);
                    gl.depthMask(false);
                    gl.enable(gl.POLYGON_OFFSET_FILL);
                    gl.polygonOffset(-1, -4);
                    gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ZERO, gl.ONE);
                    drawPieces(f, f.fixtures.asset, 'solid', 1, 0, f.fixtures.alpha);
                    gl.disable(gl.POLYGON_OFFSET_FILL);
                    gl.blendFuncSeparate(gl.ONE, gl.ONE, gl.ZERO, gl.ONE);
                    drawPieces(f, f.fixtures.asset, 'clear', 1, 0, f.fixtures.cones);
                    gl.disable(gl.DEPTH_TEST);
                    gl.blendFuncSeparate(gl.ONE, gl.ONE_MINUS_SRC_ALPHA, gl.ZERO, gl.ONE);
                }
                // 1b2. the Halloween night (26k): the candle light round the pumpkins (multiplies), their glowing faces and candles, the
                // string lights, the spider webs; all hidden by the game's depth
                if (f.hw && st.draw === null) {
                    const HW = f.hw;
                    if (depthOk && HW.pumpkins && HW.pumpkins.pool > 0.001) {
                        const Pk = HW.pumpkins;
                        gl.bindVertexArray(vao);
                        gl.useProgram(hwxProg.p);
                        depthUniforms(hwxProg, f, W, H);
                        gl.activeTexture(gl.TEXTURE0 + UNIT);
                        gl.bindTexture(gl.TEXTURE_2D, depthTex);
                        gl.uniform4fv(uni(hwxProg, 'uC'), Pk.candles);
                        gl.uniform1i(uni(hwxProg, 'uN'), Pk.n);
                        gl.uniform1f(uni(hwxProg, 'uR'), 160);
                        gl.uniform1f(uni(hwxProg, 'uAmt'), Pk.pool);
                        gl.uniform1f(uni(hwxProg, 'uDim'), Pk.dim);
                        gl.uniform3fv(uni(hwxProg, 'uCol'), [1, 0.55, 0.18]);
                        gl.blendFuncSeparate(gl.DST_COLOR, gl.ONE, gl.ZERO, gl.ONE);
                        gl.drawArrays(gl.TRIANGLES, 0, 3);
                    }
                    gl.enable(gl.DEPTH_TEST);
                    gl.depthFunc(gl.LEQUAL);
                    gl.depthMask(false);
                    if (HW.pumpkins && HW.pumpkins.glow > 0.001) {
                        const Pk = HW.pumpkins;
                        gl.enable(gl.POLYGON_OFFSET_FILL);
                        gl.polygonOffset(-1, -4);
                        gl.blendFuncSeparate(gl.ONE, gl.ONE, gl.ZERO, gl.ONE);
                        drawPieces(f, Pk.asset, 'glow', 1, Pk.glow * Pk.faces, 1);
                        gl.disable(gl.POLYGON_OFFSET_FILL);
                        gl.useProgram(glowProg.p);
                        gl.uniformMatrix4fv(uni(glowProg, 'uVP'), false, f.vp);
                        gl.uniform3fv(uni(glowProg, 'uCam'), f.cam);
                        gl.uniform4fv(uni(glowProg, 'uP'), Pk.glowPts);
                        gl.uniform1f(uni(glowProg, 'uSize'), 75);
                        gl.uniform1f(uni(glowProg, 'uPull'), 80);
                        gl.uniform3fv(uni(glowProg, 'uC0'), [1, 0.6, 0.2]);
                        gl.uniform3fv(uni(glowProg, 'uC1'), [1, 0.6, 0.2]);
                        gl.uniform1f(uni(glowProg, 'uBright'), Pk.glow);
                        gl.uniform1f(uni(glowProg, 'uTime'), f.time);
                        gl.uniform1f(uni(glowProg, 'uBlink'), 0);
                        gl.uniform1i(uni(glowProg, 'uMode'), 0);
                        gl.blendFuncSeparate(gl.ONE, gl.ONE, gl.ZERO, gl.ONE);
                        gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, Pk.n);
                    }
                    if (HW.lights && HW.lights.n > 0) {
                        const Lt = HW.lights;
                        gl.useProgram(glowProg.p);
                        gl.uniformMatrix4fv(uni(glowProg, 'uVP'), false, f.vp);
                        gl.uniform3fv(uni(glowProg, 'uCam'), f.cam);
                        gl.uniform4fv(uni(glowProg, 'uP'), Lt.pts);
                        gl.uniform1f(uni(glowProg, 'uSize'), 22);
                        gl.uniform1f(uni(glowProg, 'uPull'), 25);
                        gl.uniform3fv(uni(glowProg, 'uC0'), [1, 0.5, 0.1]);
                        gl.uniform3fv(uni(glowProg, 'uC1'), [0.65, 0.25, 1]);
                        gl.uniform1f(uni(glowProg, 'uBright'), Lt.bright);
                        gl.uniform1f(uni(glowProg, 'uTime'), f.time);
                        gl.uniform1f(uni(glowProg, 'uBlink'), Lt.blink);
                        gl.uniform1i(uni(glowProg, 'uMode'), 1);
                        gl.blendFuncSeparate(gl.ONE, gl.ONE, gl.ZERO, gl.ONE);
                        gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, Lt.n);
                    }
                    if (HW.webs) {
                        const Wb = HW.webs;
                        gl.useProgram(webProg.p);
                        gl.uniformMatrix4fv(uni(webProg, 'uVP'), false, f.vp);
                        gl.uniform4fv(uni(webProg, 'uW'), Wb.w);
                        gl.uniform2f(uni(webProg, 'uLat'), f.box.l[0], f.box.l[1]);
                        gl.uniform1f(uni(webProg, 'uSize'), Wb.size);
                        gl.uniform3fv(uni(webProg, 'uCol'), Wb.col);
                        gl.uniform1f(uni(webProg, 'uAmt'), Wb.amount);
                        gl.uniform1f(uni(webProg, 'uTime'), f.time);
                        gl.blendFuncSeparate(gl.ONE, gl.ONE_MINUS_SRC_ALPHA, gl.ZERO, gl.ONE);
                        const wasCull = gl.isEnabled(gl.CULL_FACE);
                        gl.disable(gl.CULL_FACE);
                        gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, Wb.n);
                        if (wasCull) gl.enable(gl.CULL_FACE);
                    }
                    gl.disable(gl.DEPTH_TEST);
                    gl.blendFuncSeparate(gl.ONE, gl.ONE_MINUS_SRC_ALPHA, gl.ZERO, gl.ONE);
                    gl.bindVertexArray(vao);
                }
                // 1b3. the Christmas night (26l): the warm glow round the tree (multiplies), the tree's bulbs and star, the Christmas lights
                if (f.xm && st.draw === null) {
                    const XM = f.xm;
                    if (depthOk && XM.pool) {
                        gl.bindVertexArray(vao);
                        gl.useProgram(hwxProg.p);
                        depthUniforms(hwxProg, f, W, H);
                        gl.activeTexture(gl.TEXTURE0 + UNIT);
                        gl.bindTexture(gl.TEXTURE_2D, depthTex);
                        gl.uniform4fv(uni(hwxProg, 'uC'), XM.pool.pts);
                        gl.uniform1i(uni(hwxProg, 'uN'), 1);
                        gl.uniform1f(uni(hwxProg, 'uR'), XM.pool.r);
                        gl.uniform1f(uni(hwxProg, 'uAmt'), XM.pool.amount);
                        gl.uniform1f(uni(hwxProg, 'uDim'), XM.pool.dim);
                        gl.uniform3fv(uni(hwxProg, 'uCol'), [1, 0.7, 0.35]);
                        gl.blendFuncSeparate(gl.DST_COLOR, gl.ONE, gl.ZERO, gl.ONE);
                        gl.drawArrays(gl.TRIANGLES, 0, 3);
                    }
                    gl.enable(gl.DEPTH_TEST);
                    gl.depthFunc(gl.LEQUAL);
                    gl.depthMask(false);
                    gl.useProgram(glowProg.p);
                    gl.uniformMatrix4fv(uni(glowProg, 'uVP'), false, f.vp);
                    gl.uniform3fv(uni(glowProg, 'uCam'), f.cam);
                    gl.uniform1f(uni(glowProg, 'uTime'), f.time);
                    gl.blendFuncSeparate(gl.ONE, gl.ONE, gl.ZERO, gl.ONE);
                    const bulbs = (B: KaspLobbyBulbs, size: number, pull: number, mode: number): void => {
                        gl.uniform4fv(uni(glowProg, 'uP'), B.pts);
                        gl.uniform1f(uni(glowProg, 'uSize'), size);
                        gl.uniform1f(uni(glowProg, 'uPull'), pull);
                        gl.uniform3fv(uni(glowProg, 'uC0'), [1, 0.85, 0.4]);
                        gl.uniform3fv(uni(glowProg, 'uC1'), [1, 0.85, 0.4]);
                        gl.uniform1f(uni(glowProg, 'uBright'), B.bright);
                        gl.uniform1f(uni(glowProg, 'uBlink'), B.blink);
                        gl.uniform1i(uni(glowProg, 'uMode'), mode);
                        gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, B.n);
                    };
                    if (XM.treeBulbs && XM.treeBulbs.n > 0) bulbs(XM.treeBulbs, 14, 20, 2);
                    if (XM.star) bulbs(XM.star, 45, 30, 3);
                    if (XM.lights && XM.lights.n > 0) bulbs(XM.lights, 22, 25, 2);
                    gl.disable(gl.DEPTH_TEST);
                    gl.blendFuncSeparate(gl.ONE, gl.ONE_MINUS_SRC_ALPHA, gl.ZERO, gl.ONE);
                    gl.bindVertexArray(vao);
                }
                // 1b4. the fireplace (26l, the probe's v1.88): its warm flickering light on the room and the tank (multiplies), then the
                // flames, the embers and the sparks (added, so they glow); all hidden by the game's depth
                if (f.fp && st.draw === null) {
                    const FP = f.fp;
                    if (depthOk && FP.pools.length) {
                        gl.bindVertexArray(vao);
                        gl.useProgram(hwxProg.p);
                        depthUniforms(hwxProg, f, W, H);
                        gl.activeTexture(gl.TEXTURE0 + UNIT);
                        gl.bindTexture(gl.TEXTURE_2D, depthTex);
                        gl.uniform3fv(uni(hwxProg, 'uCol'), [1, 0.52, 0.2]);
                        gl.uniform1i(uni(hwxProg, 'uN'), 1);
                        gl.blendFuncSeparate(gl.DST_COLOR, gl.ONE, gl.ZERO, gl.ONE);
                        for (const Lp of FP.pools) {
                            if (Lp.amount <= 0.001) continue;
                            gl.uniform4fv(uni(hwxProg, 'uC'), Lp.pts);
                            gl.uniform1f(uni(hwxProg, 'uR'), Lp.r);
                            gl.uniform1f(uni(hwxProg, 'uAmt'), Lp.amount);
                            gl.uniform1f(uni(hwxProg, 'uDim'), Lp.dim);
                            gl.drawArrays(gl.TRIANGLES, 0, 3);
                        }
                    }
                    gl.enable(gl.DEPTH_TEST);
                    gl.depthFunc(gl.LEQUAL);
                    gl.depthMask(false);
                    gl.blendFuncSeparate(gl.ONE, gl.ONE, gl.ZERO, gl.ONE);
                    if (FP.fire.n > 0) {
                        gl.useProgram(fireProg.p);
                        gl.uniformMatrix4fv(uni(fireProg, 'uVP'), false, f.vp);
                        gl.uniform3fv(uni(fireProg, 'uCam'), f.cam);
                        gl.uniform1f(uni(fireProg, 'uTime'), f.time);
                        gl.uniform1f(uni(fireProg, 'uPull'), FP.pull);
                        gl.uniform1f(uni(fireProg, 'uBright'), FP.bright);
                        gl.uniform4fv(uni(fireProg, 'uP'), FP.fire.P);
                        gl.uniform4fv(uni(fireProg, 'uQ'), FP.fire.Q);
                        const wasCull = gl.isEnabled(gl.CULL_FACE);
                        gl.disable(gl.CULL_FACE);
                        gl.bindVertexArray(vao);
                        gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, FP.fire.n);
                        if (wasCull) gl.enable(gl.CULL_FACE);
                    }
                    gl.disable(gl.DEPTH_TEST);
                    gl.blendFuncSeparate(gl.ONE, gl.ONE_MINUS_SRC_ALPHA, gl.ZERO, gl.ONE);
                    gl.bindVertexArray(vao);
                }
                // 1c. the lamps at night: their light on the tank, the platform and the floor (after the night colour, like real light),
                // then (if wanted) a glow on their lenses
                if (depthOk && f.lamps) {
                    const L = f.lamps;
                    const n = Math.min(8, L.list.length);
                    lampArray.fill(0);
                    for (let i = 0; i < n; i++) for (let a = 0; a < 3; a++) lampArray[i * 3 + a] = L.list[i][a] + f.offset[a];
                    gl.useProgram(lampProg.p);
                    depthUniforms(lampProg, f, W, H);
                    gl.uniform3fv(uni(lampProg, 'uLamp'), lampArray);
                    gl.uniform1i(uni(lampProg, 'uN'), n);
                    gl.uniform1f(uni(lampProg, 'uPower'), L.power);
                    gl.uniform1f(uni(lampProg, 'uReach'), L.reach);
                    gl.uniform1f(uni(lampProg, 'uGlow'), L.glow);
                    gl.uniform3fv(uni(lampProg, 'uCol'), L.color);
                    gl.uniformMatrix4fv(uni(lampProg, 'uVP'), false, f.vp);
                    gl.uniform1i(uni(lampProg, 'uMode'), 0);
                    gl.blendFuncSeparate(gl.DST_COLOR, gl.ONE, gl.ZERO, gl.ONE);
                    gl.drawArrays(gl.TRIANGLES, 0, 3);
                    if (L.glow > 0.001) {
                        gl.uniform1i(uni(lampProg, 'uMode'), 1);
                        gl.blendFuncSeparate(gl.ONE, gl.ONE, gl.ZERO, gl.ONE);
                        gl.drawArrays(gl.TRIANGLES, 0, 3);
                    }
                }
                // 1c2. the warning beacon while the game searches (26d step 9): its light on everything (multiplies)
                if (depthOk && f.siren && sirenProg) {
                    const Sr = f.siren;
                    const pr = sirenProg;
                    sirenDrawn++;
                    const n = Math.min(8, Sr.lamps.length);
                    sirenLamps.fill(0);
                    for (let i = 0; i < n; i++) for (let a = 0; a < 3; a++) sirenLamps[i * 3 + a] = Sr.lamps[i][a] + f.offset[a];
                    gl.useProgram(pr.p);
                    depthUniforms(pr, f, W, H);
                    gl.uniform3fv(uni(pr, 'uLamp'), sirenLamps);
                    gl.uniform3fv(uni(pr, 'uRot'), Sr.rot);
                    gl.uniform3fv(uni(pr, 'uStb'), Sr.stb);
                    gl.uniform2fv(uni(pr, 'uDir'), Sr.dir);
                    gl.uniform1i(uni(pr, 'uN'), n);
                    gl.uniform1f(uni(pr, 'uReach'), Sr.reach);
                    gl.uniform1f(uni(pr, 'uBeamReach'), Sr.beamReach);
                    gl.uniform1f(uni(pr, 'uBeam'), Sr.beam);
                    gl.blendFuncSeparate(gl.DST_COLOR, gl.ONE, gl.ZERO, gl.ONE);
                    gl.drawArrays(gl.TRIANGLES, 0, 3);
                    gl.blendFuncSeparate(gl.ONE, gl.ONE_MINUS_SRC_ALPHA, gl.ZERO, gl.ONE);
                }
                // 1d. the wet floor by the door (26g5): darker, puddles mirroring the picture drawn so far (copied first), bright in a flash
                if (depthOk && f.wet) {
                    const Wt = f.wet;
                    const hasCol = st.draw === null && copyColour(W, H);
                    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, st.draw);
                    gl.viewport(0, 0, W, H);
                    gl.useProgram(wetProg.p);
                    depthUniforms(wetProg, f, W, H);
                    gl.activeTexture(gl.TEXTURE0 + PANO);
                    gl.bindTexture(gl.TEXTURE_2D, hasCol ? colTex : null);
                    gl.bindSampler(PANO, null);
                    gl.uniform1i(uni(wetProg, 'uCol'), PANO);
                    gl.activeTexture(gl.TEXTURE0 + UNIT);
                    gl.bindTexture(gl.TEXTURE_2D, depthTex);
                    gl.uniformMatrix4fv(uni(wetProg, 'uVP'), false, f.vp);
                    gl.uniform2f(uni(wetProg, 'uLat'), f.box.l[0], f.box.l[1]);
                    gl.uniform3fv(uni(wetProg, 'uLim'), Wt.lim);
                    gl.uniform3fv(uni(wetProg, 'uSky'), Wt.sky);
                    gl.uniform3fv(uni(wetProg, 'uFlashCol'), [0.78, 0.84, 1]);
                    gl.uniform1f(uni(wetProg, 'uAmt'), Wt.amount);
                    gl.uniform1f(uni(wetProg, 'uDepthW'), Wt.depth);
                    gl.uniform1f(uni(wetProg, 'uPud'), Wt.puddles);
                    gl.uniform1f(uni(wetProg, 'uShine'), Wt.shine);
                    gl.uniform1f(uni(wetProg, 'uFloorZ'), Wt.floorZ);
                    gl.uniform1f(uni(wetProg, 'uFlash'), Wt.flash);
                    gl.uniform1f(uni(wetProg, 'uTime'), f.time);
                    gl.uniform1f(uni(wetProg, 'uHasCol'), hasCol ? 1 : 0);
                    gl.uniform1f(uni(wetProg, 'uRings'), Wt.rings);
                    gl.blendFuncSeparate(gl.ONE, gl.ONE_MINUS_SRC_ALPHA, gl.ZERO, gl.ONE);
                    gl.bindVertexArray(vao);
                    gl.drawArrays(gl.TRIANGLES, 0, 3);
                }
                // 1e. the blown-in snow drift on the floor just inside the door (26j)
                if (depthOk && f.swx && f.swx.drift && st.draw === null) {
                    const D = f.swx.drift;
                    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, st.draw);
                    gl.viewport(0, 0, W, H);
                    gl.useProgram(driftProg.p);
                    depthUniforms(driftProg, f, W, H);
                    gl.activeTexture(gl.TEXTURE0 + UNIT);
                    gl.bindTexture(gl.TEXTURE_2D, depthTex);
                    gl.uniform2f(uni(driftProg, 'uLat'), f.box.l[0], f.box.l[1]);
                    gl.uniform3fv(uni(driftProg, 'uLim'), D.lim);
                    gl.uniform3fv(uni(driftProg, 'uCol'), D.color);
                    gl.uniform1f(uni(driftProg, 'uAmt'), D.amount);
                    gl.uniform1f(uni(driftProg, 'uDepthW'), D.depth);
                    gl.uniform1f(uni(driftProg, 'uGust'), D.gust);
                    gl.uniform1f(uni(driftProg, 'uFloorZ'), D.floorZ);
                    gl.uniform1f(uni(driftProg, 'uTime'), f.time);
                    gl.uniform1f(uni(driftProg, 'uSpark'), D.spark);
                    gl.blendFuncSeparate(gl.ONE, gl.ONE_MINUS_SRC_ALPHA, gl.ZERO, gl.ONE);
                    gl.bindVertexArray(vao);
                    gl.drawArrays(gl.TRIANGLES, 0, 3);
                }
                gl.blendFuncSeparate(gl.ONE, gl.ONE_MINUS_SRC_ALPHA, gl.ZERO, gl.ONE);
                // 2. snow lying on the ground, fog, sun glow, stars (laid over)
                if (depthOk && A) {
                    gl.useProgram(atmos.p);
                    depthUniforms(atmos, f, W, H);
                    gl.uniform1f(uni(atmos, 'uTime'), f.time);
                    gl.uniform1f(uni(atmos, 'uStars'), A.stars);
                    gl.uniform1f(uni(atmos, 'uSpark'), A.spark);
                    gl.uniform1f(uni(atmos, 'uFog'), A.fog);
                    gl.uniform1f(uni(atmos, 'uFogStart'), A.fogStart);
                    gl.uniform1f(uni(atmos, 'uFogHeight'), A.fogHeight);
                    gl.uniform1f(uni(atmos, 'uFogMove'), A.fogMove);
                    gl.uniform1f(uni(atmos, 'uCover'), A.cover);
                    gl.uniform1f(uni(atmos, 'uGlow'), A.glow);
                    gl.uniform1f(uni(atmos, 'uGroundZ'), A.groundZ);
                    gl.uniform1f(uni(atmos, 'uSkyZ'), A.skyZ);
                    gl.uniform1f(uni(atmos, 'uSkyNear'), f.box.skyNear);
                    gl.uniform1f(uni(atmos, 'uSkyLow'), f.box.skyLow);
                    gl.uniform1f(uni(atmos, 'uZones'), 0);
                    gl.uniform1f(uni(atmos, 'uFlash'), A.flash);
                    gl.uniform1f(uni(atmos, 'uBolt'), A.bolt);
                    gl.uniform3fv(uni(atmos, 'uFlashCol'), A.flashCol);
                    gl.uniform2f(uni(atmos, 'uLatD'), f.box.l[0], f.box.l[1]);
                    gl.uniform1i(uni(atmos, 'uBoltTex'), PANO);
                    gl.uniform1f(uni(atmos, 'uCloud'), A.cloud);
                    gl.uniform1f(uni(atmos, 'uCloudK'), A.cloudK);
                    gl.uniform1f(uni(atmos, 'uCloudSpeed'), A.cloudSpeed);
                    gl.uniform3fv(uni(atmos, 'uCloudCol'), A.cloudCol);
                    gl.uniform3fv(uni(atmos, 'uFogCol'), A.fogCol);
                    gl.uniform3fv(uni(atmos, 'uSunDir'), A.sunDir);
                    gl.uniform3fv(uni(atmos, 'uSunCol'), A.sunCol);
                    gl.uniform3fv(uni(atmos, 'uCoverCol'), A.coverCol);
                    gl.uniform1f(uni(atmos, 'uCoverThick'), A.coverThick);
                    gl.drawArrays(gl.TRIANGLES, 0, 3);
                }
                // 2a. the foggy looks' extras (26h): the beam's lit patch (multiplies, like light), then the floor fog, the fog banks, the
                // light shaft, the searchlight and the lamps' cones (laid over)
                if (depthOk && f.fogx) {
                    const X = f.fogx;
                    gl.useProgram(fogxProg.p);
                    depthUniforms(fogxProg, f, W, H);
                    gl.uniformMatrix4fv(uni(fogxProg, 'uVP'), false, f.vp);
                    gl.uniform2f(uni(fogxProg, 'uLat'), f.box.l[0], f.box.l[1]);
                    gl.uniform3fv(uni(fogxProg, 'uRoomMax'), f.box.roomMax);
                    gl.uniform1f(uni(fogxProg, 'uTime'), f.time);
                    gl.uniform1f(uni(fogxProg, 'uFloorZ'), f.box.floorZ);
                    gl.uniform1f(uni(fogxProg, 'uGroundZ'), f.box.groundZ);
                    gl.uniform1f(uni(fogxProg, 'uFar'), X.far);
                    gl.uniform1f(uni(fogxProg, 'uFlAmt'), X.floor);
                    gl.uniform1f(uni(fogxProg, 'uFlH'), X.floorH);
                    gl.uniform1f(uni(fogxProg, 'uFlDepth'), X.floorDepth);
                    gl.uniform1f(uni(fogxProg, 'uFlSpeed'), X.floorSpeed);
                    gl.uniform1f(uni(fogxProg, 'uFlLump'), X.floorLumps);
                    gl.uniform1f(uni(fogxProg, 'uFlOutR'), X.floorOut);
                    gl.uniform3fv(uni(fogxProg, 'uFlIn'), X.floorIn);
                    gl.uniform3fv(uni(fogxProg, 'uFlOutC'), X.floorOutCol);
                    gl.uniform1f(uni(fogxProg, 'uBkAmt'), X.banks);
                    gl.uniform1f(uni(fogxProg, 'uBkSize'), X.bankSize);
                    gl.uniform1f(uni(fogxProg, 'uBkSpeed'), X.bankSpeed);
                    gl.uniform1f(uni(fogxProg, 'uBkGap'), X.bankGaps);
                    gl.uniform1f(uni(fogxProg, 'uBkHigh'), X.bankHigh);
                    gl.uniform1f(uni(fogxProg, 'uBkStart'), X.bankStart);
                    gl.uniform3fv(uni(fogxProg, 'uBkCol'), X.bankCol);
                    gl.uniform1f(uni(fogxProg, 'uBmAmt'), X.beam);
                    gl.uniform1f(uni(fogxProg, 'uBmPool'), X.pool);
                    gl.uniform1f(uni(fogxProg, 'uBmDust'), X.dust);
                    gl.uniform1f(uni(fogxProg, 'uBmSoft'), X.soft);
                    gl.uniform3fv(uni(fogxProg, 'uBmCol'), X.beamCol);
                    gl.uniform3fv(uni(fogxProg, 'uBmDir'), X.beamDir);
                    gl.uniform3fv(uni(fogxProg, 'uDoor'), X.door);
                    gl.uniform1f(uni(fogxProg, 'uSkyZ'), f.box.skyZ);
                    gl.uniform1f(uni(fogxProg, 'uSkyNear'), f.box.skyNear);
                    gl.uniform1f(uni(fogxProg, 'uSkyLow'), f.box.skyLow);
                    const NX = f.nightx;
                    const Sl = NX !== null ? NX.search : null;
                    const Cn = NX !== null ? NX.cones : null;
                    gl.uniform1f(uni(fogxProg, 'uSlAmt'), Sl !== null ? Sl.amount : 0);
                    if (Sl !== null) {
                        gl.uniform1f(uni(fogxProg, 'uSlW'), Sl.width);
                        gl.uniform3fv(uni(fogxProg, 'uSlO'), Sl.origin);
                        gl.uniform3fv(uni(fogxProg, 'uSlD'), Sl.dir);
                        gl.uniform3fv(uni(fogxProg, 'uSlCol'), Sl.color);
                    }
                    gl.uniform1f(uni(fogxProg, 'uCnAmt'), Cn !== null ? Cn.amount : 0);
                    if (Cn !== null) {
                        const n = Math.min(8, Cn.lamps.length);
                        lampArray.fill(0);
                        for (let i = 0; i < n; i++) for (let a = 0; a < 3; a++) lampArray[i * 3 + a] = Cn.lamps[i][a] + f.offset[a];
                        gl.uniform3fv(uni(fogxProg, 'uCnLamp'), lampArray);
                        gl.uniform1i(uni(fogxProg, 'uCnN'), n);
                        gl.uniform1f(uni(fogxProg, 'uCnTan'), Math.tan((Cn.angle * Math.PI) / 180));
                        gl.uniform1f(uni(fogxProg, 'uCnReach'), Cn.reach);
                        gl.uniform1f(uni(fogxProg, 'uCnDust'), Cn.dust);
                        gl.uniform3fv(uni(fogxProg, 'uCnCol'), Cn.color);
                    } else gl.uniform1i(uni(fogxProg, 'uCnN'), 0);
                    if (X.pool > 0.001) {
                        gl.uniform1i(uni(fogxProg, 'uMode'), 0);
                        gl.blendFuncSeparate(gl.DST_COLOR, gl.ONE, gl.ZERO, gl.ONE);
                        gl.drawArrays(gl.TRIANGLES, 0, 3);
                    }
                    if (X.floor > 0 || X.banks > 0 || X.beam > 0 || Sl !== null || Cn !== null) {
                        gl.uniform1i(uni(fogxProg, 'uMode'), 1);
                        gl.blendFuncSeparate(gl.ONE, gl.ONE_MINUS_SRC_ALPHA, gl.ZERO, gl.ONE);
                        gl.drawArrays(gl.TRIANGLES, 0, 3);
                    }
                    gl.blendFuncSeparate(gl.ONE, gl.ONE_MINUS_SRC_ALPHA, gl.ZERO, gl.ONE);
                }
                // 2a2. the night's street lamps and red warning light: posts, then the glows (added), hidden behind buildings
                if (f.nightx && (f.nightx.lamps || f.nightx.red) && st.draw === null) {
                    const NX = f.nightx;
                    gl.useProgram(nightxProg.p);
                    gl.uniformMatrix4fv(uni(nightxProg, 'uVP'), false, f.vp);
                    gl.uniform3fv(uni(nightxProg, 'uCam'), f.cam);
                    gl.uniform2f(uni(nightxProg, 'uOut'), f.box.o[0], f.box.o[1]);
                    gl.uniform2f(uni(nightxProg, 'uLat'), f.box.l[0], f.box.l[1]);
                    gl.uniform1f(uni(nightxProg, 'uGround'), f.box.groundZ);
                    gl.uniform3fv(uni(nightxProg, 'uFogCol'), NX.fogCol);
                    gl.uniform1f(uni(nightxProg, 'uFog'), NX.fog);
                    gl.uniform1f(uni(nightxProg, 'uFogStart'), NX.fogStart);
                    gl.enable(gl.DEPTH_TEST);
                    gl.depthFunc(gl.LEQUAL);
                    gl.depthMask(false);
                    if (NX.lamps) {
                        const Lm = NX.lamps;
                        gl.uniform1f(uni(nightxProg, 'uStart'), Lm.start);
                        gl.uniform1f(uni(nightxProg, 'uGap'), Lm.gap);
                        gl.uniform1f(uni(nightxProg, 'uH'), Lm.height);
                        gl.uniform2f(uni(nightxProg, 'uSides'), Lm.left, Lm.right);
                        gl.uniform1f(uni(nightxProg, 'uSize'), Lm.size);
                        gl.uniform3fv(uni(nightxProg, 'uPostCol'), Lm.postCol);
                        gl.uniform1i(uni(nightxProg, 'uMode'), 0);
                        gl.blendFuncSeparate(gl.ONE, gl.ZERO, gl.ZERO, gl.ONE);
                        gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, Lm.count * 2);
                        gl.uniform1i(uni(nightxProg, 'uMode'), 1);
                        gl.uniform3fv(uni(nightxProg, 'uCol'), Lm.color);
                        gl.uniform1f(uni(nightxProg, 'uBright'), Lm.bright);
                        gl.uniform1f(uni(nightxProg, 'uHalo'), Lm.halo);
                        gl.blendFuncSeparate(gl.ONE, gl.ONE, gl.ZERO, gl.ONE);
                        gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, Lm.count * 2);
                    }
                    if (NX.red && NX.red.bright > 0.002) {
                        gl.uniform1i(uni(nightxProg, 'uMode'), 2);
                        gl.uniform3fv(uni(nightxProg, 'uRed'), NX.red.pos);
                        gl.uniform1f(uni(nightxProg, 'uRedSize'), NX.red.size);
                        gl.uniform3fv(uni(nightxProg, 'uCol'), [1, 0.12, 0.08]);
                        gl.uniform1f(uni(nightxProg, 'uBright'), NX.red.bright);
                        gl.uniform1f(uni(nightxProg, 'uHalo'), NX.red.halo);
                        gl.blendFuncSeparate(gl.ONE, gl.ONE, gl.ZERO, gl.ONE);
                        gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, 1);
                    }
                    gl.disable(gl.DEPTH_TEST);
                    gl.blendFuncSeparate(gl.ONE, gl.ONE_MINUS_SRC_ALPHA, gl.ZERO, gl.ONE);
                    gl.bindVertexArray(vao);
                }
                // 2a2b. the clear night's extras: the street lamps' light on the street (multiplies), the town's lit windows and the
                // shooting star (added)
                if (depthOk && f.ncx) {
                    const NC = f.ncx;
                    if (NC.pools || NC.windows || NC.meteor || NC.stars > 0) {
                        const hasPic = !!(NC.windows || NC.meteor || NC.stars > 0) && st.draw === null && copyColour(W, H);
                        gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, st.draw);
                        gl.viewport(0, 0, W, H);
                        gl.bindVertexArray(vao);
                        gl.useProgram(ncxProg.p);
                        depthUniforms(ncxProg, f, W, H);
                        gl.activeTexture(gl.TEXTURE0 + PANO);
                        gl.bindTexture(gl.TEXTURE_2D, hasPic ? colTex : null);
                        gl.bindSampler(PANO, null);
                        gl.uniform1i(uni(ncxProg, 'uPic'), PANO);
                        gl.uniform1f(uni(ncxProg, 'uHasPic'), hasPic ? 1 : 0);
                        gl.activeTexture(gl.TEXTURE0 + UNIT);
                        gl.bindTexture(gl.TEXTURE_2D, depthTex);
                        gl.uniform1f(uni(ncxProg, 'uTime'), f.time);
                        gl.uniform1f(uni(ncxProg, 'uGroundZ'), f.box.groundZ);
                        gl.uniform1f(uni(ncxProg, 'uSkyZ'), f.box.skyZ);
                        gl.uniform1f(uni(ncxProg, 'uSkyNear'), f.box.skyNear);
                        gl.uniform1f(uni(ncxProg, 'uSkyLow'), f.box.skyLow);
                        gl.uniform2f(uni(ncxProg, 'uLat'), f.box.l[0], f.box.l[1]);
                        gl.uniform3fv(uni(ncxProg, 'uHor'), NC.hor);
                        gl.uniform3fv(uni(ncxProg, 'uZen'), NC.zen);
                        const Wn = NC.windows;
                        gl.uniform1f(uni(ncxProg, 'uWnAmt'), Wn ? Wn.amount : 0);
                        if (Wn) {
                            gl.uniform1f(uni(ncxProg, 'uWnDense'), Wn.dense);
                            gl.uniform1f(uni(ncxProg, 'uWnSize'), Math.max(0.1, Wn.size));
                            gl.uniform1f(uni(ncxProg, 'uWnNear'), Wn.near);
                            gl.uniform1f(uni(ncxProg, 'uWnFar'), Wn.far);
                            gl.uniform1f(uni(ncxProg, 'uWnChange'), Wn.change);
                        }
                        const Mt = NC.meteor;
                        gl.uniform1f(uni(ncxProg, 'uMetB'), Mt ? Mt.bright : 0);
                        if (Mt) {
                            gl.uniform4f(uni(ncxProg, 'uMet'), Mt.a[0], Mt.a[1], Mt.b[0], Mt.b[1]);
                            gl.uniform1f(uni(ncxProg, 'uMetT'), Mt.t);
                            gl.uniform1f(uni(ncxProg, 'uMetLen'), Mt.length);
                            gl.uniform1f(uni(ncxProg, 'uMetW'), Mt.width);
                        }
                        gl.uniform1f(uni(ncxProg, 'uStars'), NC.stars);
                        if (NC.pools) {
                            const Pl = NC.pools;
                            gl.uniform1f(uni(ncxProg, 'uPlAmt'), Pl.amount);
                            gl.uniform1f(uni(ncxProg, 'uPlR'), Pl.r);
                            gl.uniform1f(uni(ncxProg, 'uPlStart'), Pl.start);
                            gl.uniform1f(uni(ncxProg, 'uPlGap'), Pl.gap);
                            gl.uniform1f(uni(ncxProg, 'uPlH'), Pl.h);
                            gl.uniform2f(uni(ncxProg, 'uPlSides'), Pl.sides[0], Pl.sides[1]);
                            gl.uniform1i(uni(ncxProg, 'uPlN'), Pl.n);
                            gl.uniform3fv(uni(ncxProg, 'uPlCol'), Pl.color);
                            gl.uniform1i(uni(ncxProg, 'uMode'), 0);
                            gl.blendFuncSeparate(gl.DST_COLOR, gl.ONE, gl.ZERO, gl.ONE);
                            gl.drawArrays(gl.TRIANGLES, 0, 3);
                        }
                        if (NC.windows || NC.meteor || NC.stars > 0) {
                            gl.uniform1i(uni(ncxProg, 'uMode'), 1);
                            gl.blendFuncSeparate(gl.ONE, gl.ONE, gl.ZERO, gl.ONE);
                            gl.drawArrays(gl.TRIANGLES, 0, 3);
                        }
                        gl.blendFuncSeparate(gl.ONE, gl.ONE_MINUS_SRC_ALPHA, gl.ZERO, gl.ONE);
                    }
                    // then the fireflies (added glow) and the moths at the ring lamps, hidden by the game's depth
                    if ((NC.flies || NC.moths) && st.draw === null) {
                        gl.enable(gl.DEPTH_TEST);
                        gl.depthFunc(gl.LEQUAL);
                        gl.depthMask(false);
                        gl.useProgram(ncbProg.p);
                        gl.uniformMatrix4fv(uni(ncbProg, 'uVP'), false, f.vp);
                        gl.uniform3fv(uni(ncbProg, 'uCam'), f.cam);
                        gl.uniform2f(uni(ncbProg, 'uOut'), f.box.o[0], f.box.o[1]);
                        gl.uniform2f(uni(ncbProg, 'uLat'), f.box.l[0], f.box.l[1]);
                        gl.uniform1f(uni(ncbProg, 'uTime'), f.time);
                        gl.uniform1f(uni(ncbProg, 'uGround'), f.box.groundZ);
                        gl.uniform1f(uni(ncbProg, 'uSlow'), 0);
                        if (NC.flies) {
                            const Fl = NC.flies;
                            gl.uniform1i(uni(ncbProg, 'uMode'), 0);
                            gl.uniform2f(uni(ncbProg, 'uSpan'), Fl.span[0], Fl.span[1]);
                            gl.uniform2f(uni(ncbProg, 'uDist'), Fl.near, Fl.far);
                            gl.uniform1f(uni(ncbProg, 'uH'), Fl.height);
                            gl.uniform1f(uni(ncbProg, 'uSize'), Fl.size);
                            gl.uniform1f(uni(ncbProg, 'uSpeed'), Fl.speed);
                            gl.uniform3fv(uni(ncbProg, 'uCol'), Fl.color);
                            gl.uniform1f(uni(ncbProg, 'uBright'), Fl.bright);
                            gl.blendFuncSeparate(gl.ONE, gl.ONE, gl.ZERO, gl.ONE);
                            gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, Fl.n);
                        }
                        if (NC.moths) {
                            const Mo = NC.moths;
                            const n = Math.min(8, Mo.lamps.length);
                            lampArray.fill(0);
                            for (let i = 0; i < n; i++) for (let k = 0; k < 3; k++) lampArray[i * 3 + k] = Mo.lamps[i][k] + f.offset[k];
                            gl.uniform3fv(uni(ncbProg, 'uLamp'), lampArray);
                            gl.uniform1i(uni(ncbProg, 'uLampN'), n);
                            gl.uniform1i(uni(ncbProg, 'uMode'), 1);
                            gl.uniform1f(uni(ncbProg, 'uSize'), Mo.size);
                            gl.uniform1f(uni(ncbProg, 'uSpeed'), Mo.speed);
                            gl.uniform3fv(uni(ncbProg, 'uCol'), Mo.color);
                            gl.uniform1f(uni(ncbProg, 'uBright'), Mo.alpha);
                            gl.blendFuncSeparate(gl.ONE, gl.ONE_MINUS_SRC_ALPHA, gl.ZERO, gl.ONE);
                            gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, Mo.perLamp * n);
                        }
                        gl.disable(gl.DEPTH_TEST);
                        gl.bindVertexArray(vao);
                        gl.blendFuncSeparate(gl.ONE, gl.ONE_MINUS_SRC_ALPHA, gl.ZERO, gl.ONE);
                    }
                }
                // 2a2c. the Halloween night's will-o'-wisps among the trees and the bats, one of them now and then into the hangar (26k)
                if (depthOk && f.hw && (f.hw.wisps || f.hw.bats) && st.draw === null) {
                    const HW = f.hw;
                    gl.enable(gl.DEPTH_TEST);
                    gl.depthFunc(gl.LEQUAL);
                    gl.depthMask(false);
                    if (HW.wisps) {
                        const Wp = HW.wisps;
                        gl.useProgram(ncbProg.p);
                        gl.uniformMatrix4fv(uni(ncbProg, 'uVP'), false, f.vp);
                        gl.uniform3fv(uni(ncbProg, 'uCam'), f.cam);
                        gl.uniform2f(uni(ncbProg, 'uOut'), f.box.o[0], f.box.o[1]);
                        gl.uniform2f(uni(ncbProg, 'uLat'), f.box.l[0], f.box.l[1]);
                        gl.uniform1f(uni(ncbProg, 'uTime'), f.time);
                        gl.uniform1f(uni(ncbProg, 'uGround'), f.box.groundZ);
                        gl.uniform1f(uni(ncbProg, 'uSlow'), 1);
                        gl.uniform1i(uni(ncbProg, 'uMode'), 0);
                        gl.uniform2f(uni(ncbProg, 'uSpan'), Wp.span[0], Wp.span[1]);
                        gl.uniform2f(uni(ncbProg, 'uDist'), Wp.near, Wp.far);
                        gl.uniform1f(uni(ncbProg, 'uH'), Wp.height);
                        gl.uniform1f(uni(ncbProg, 'uSize'), Wp.size);
                        gl.uniform1f(uni(ncbProg, 'uSpeed'), Wp.speed);
                        gl.uniform3fv(uni(ncbProg, 'uCol'), Wp.color);
                        gl.uniform1f(uni(ncbProg, 'uBright'), Wp.bright);
                        gl.blendFuncSeparate(gl.ONE, gl.ONE, gl.ZERO, gl.ONE);
                        gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, Wp.n);
                    }
                    if (HW.bats) {
                        const B = HW.bats;
                        gl.useProgram(birdProg.p);
                        gl.uniformMatrix4fv(uni(birdProg, 'uVP'), false, f.vp);
                        gl.uniform3fv(uni(birdProg, 'uCam'), f.cam);
                        gl.uniform2f(uni(birdProg, 'uOut'), f.box.o[0], f.box.o[1]);
                        gl.uniform2f(uni(birdProg, 'uLat'), f.box.l[0], f.box.l[1]);
                        gl.uniform2f(uni(birdProg, 'uDist'), B.near, B.far);
                        gl.uniform2f(uni(birdProg, 'uZ'), B.low, B.high);
                        gl.uniform2f(uni(birdProg, 'uSpan'), f.box.u[0], f.box.u[1]);
                        gl.uniform1f(uni(birdProg, 'uTime'), f.time);
                        gl.uniform1f(uni(birdProg, 'uSize'), B.size);
                        gl.uniform1f(uni(birdProg, 'uSpeed'), B.speed);
                        gl.uniform3fv(uni(birdProg, 'uHaze'), B.haze);
                        gl.uniform1f(uni(birdProg, 'uBat'), 1);
                        const one = B.one;
                        if (one !== null) gl.uniform4f(uni(birdProg, 'uOne'), one[0], one[1], one[2], 1);
                        else gl.uniform4f(uni(birdProg, 'uOne'), 0, 0, 0, 0);
                        gl.blendFuncSeparate(gl.ONE, gl.ONE_MINUS_SRC_ALPHA, gl.ZERO, gl.ONE);
                        const wasCull = gl.isEnabled(gl.CULL_FACE);
                        gl.disable(gl.CULL_FACE);
                        gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, B.n + (one !== null ? 1 : 0));
                        if (wasCull) gl.enable(gl.CULL_FACE);
                    }
                    gl.disable(gl.DEPTH_TEST);
                    gl.blendFuncSeparate(gl.ONE, gl.ONE_MINUS_SRC_ALPHA, gl.ZERO, gl.ONE);
                    gl.bindVertexArray(vao);
                }
                // 2a3a. the normal day's extras: the white clouds (laid over the sky), then the leaves (hidden by the game's depth)
                if (depthOk && f.ndx) {
                    const NX = f.ndx;
                    if (NX.clouds) {
                        const C = NX.clouds;
                        const hasPic = st.draw === null && copyColour(W, H);
                        gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, st.draw);
                        gl.viewport(0, 0, W, H);
                        gl.bindVertexArray(vao);
                        gl.useProgram(cloudxProg.p);
                        depthUniforms(cloudxProg, f, W, H);
                        gl.activeTexture(gl.TEXTURE0 + PANO);
                        gl.bindTexture(gl.TEXTURE_2D, hasPic ? colTex : null);
                        gl.bindSampler(PANO, null);
                        gl.uniform1i(uni(cloudxProg, 'uPic'), PANO);
                        gl.uniform1f(uni(cloudxProg, 'uHasPic'), hasPic ? 1 : 0);
                        gl.activeTexture(gl.TEXTURE0 + UNIT);
                        gl.bindTexture(gl.TEXTURE_2D, depthTex);
                        gl.uniform1f(uni(cloudxProg, 'uTime'), f.time);
                        gl.uniform1f(uni(cloudxProg, 'uAmt'), C.amount);
                        gl.uniform1f(uni(cloudxProg, 'uCover'), C.cover);
                        gl.uniform1f(uni(cloudxProg, 'uSize'), C.size);
                        gl.uniform1f(uni(cloudxProg, 'uSpeed'), C.speed);
                        gl.uniform1f(uni(cloudxProg, 'uSkyZ'), f.box.skyZ);
                        gl.uniform1f(uni(cloudxProg, 'uSkyNear'), f.box.skyNear);
                        gl.uniform1f(uni(cloudxProg, 'uSkyLow'), f.box.skyLow);
                        gl.uniform3fv(uni(cloudxProg, 'uCol'), C.color);
                        gl.uniform3fv(uni(cloudxProg, 'uShade'), C.shade);
                        gl.blendFuncSeparate(gl.ONE, gl.ONE_MINUS_SRC_ALPHA, gl.ZERO, gl.ONE);
                        gl.drawArrays(gl.TRIANGLES, 0, 3);
                    }
                    if (NX.leaves && st.draw === null && NX.leaves.n > 0) {
                        const L = NX.leaves;
                        gl.enable(gl.DEPTH_TEST);
                        gl.depthFunc(gl.LEQUAL);
                        gl.depthMask(false);
                        gl.blendFuncSeparate(gl.ONE, gl.ONE_MINUS_SRC_ALPHA, gl.ZERO, gl.ONE);
                        gl.useProgram(leafProg.p);
                        gl.uniformMatrix4fv(uni(leafProg, 'uVP'), false, f.vp);
                        gl.uniform3fv(uni(leafProg, 'uCam'), f.cam);
                        gl.uniform4fv(uni(leafProg, 'uP'), L.P);
                        gl.uniform4fv(uni(leafProg, 'uA'), L.A);
                        gl.uniform4fv(uni(leafProg, 'uB'), L.B);
                        gl.uniform1f(uni(leafProg, 'uSize'), L.size);
                        gl.uniform1f(uni(leafProg, 'uGround'), L.ground);
                        gl.uniform1f(uni(leafProg, 'uFloor'), L.floor);
                        gl.uniform1f(uni(leafProg, 'uWall'), f.box.wall);
                        gl.uniform2f(uni(leafProg, 'uOut'), f.box.o[0], f.box.o[1]);
                        gl.uniform3fv(uni(leafProg, 'uLight'), L.light);
                        gl.uniform3fv(uni(leafProg, 'uSun'), L.sun);
                        // the shadows on the street first, then the leaves
                        gl.uniform1i(uni(leafProg, 'uMode'), 1);
                        gl.enable(gl.POLYGON_OFFSET_FILL);
                        gl.polygonOffset(-1, -4);
                        gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 10, L.n);
                        gl.disable(gl.POLYGON_OFFSET_FILL);
                        gl.uniform1i(uni(leafProg, 'uMode'), 0);
                        gl.enable(gl.POLYGON_OFFSET_FILL);
                        gl.polygonOffset(-1, -8);
                        gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 10, L.n);
                        gl.disable(gl.POLYGON_OFFSET_FILL);
                        gl.disable(gl.DEPTH_TEST);
                        gl.bindVertexArray(vao);
                    }
                    gl.blendFuncSeparate(gl.ONE, gl.ONE_MINUS_SRC_ALPHA, gl.ZERO, gl.ONE);
                }
                // 2a3. the very sunny day's extras (26i): the birds (hidden by the game's depth), then the heat shimmer last (it reads a
                // copy of everything drawn so far)
                if (depthOk && f.sunx) {
                    const SX = f.sunx;
                    if (SX.birds && st.draw === null) {
                        gl.enable(gl.DEPTH_TEST);
                        gl.depthFunc(gl.LEQUAL);
                        gl.depthMask(false);
                        gl.blendFuncSeparate(gl.ONE, gl.ONE_MINUS_SRC_ALPHA, gl.ZERO, gl.ONE);
                        if (SX.birds) {
                            const B = SX.birds;
                            gl.useProgram(birdProg.p);
                            gl.uniformMatrix4fv(uni(birdProg, 'uVP'), false, f.vp);
                            gl.uniform3fv(uni(birdProg, 'uCam'), f.cam);
                            gl.uniform2f(uni(birdProg, 'uOut'), f.box.o[0], f.box.o[1]);
                            gl.uniform2f(uni(birdProg, 'uLat'), f.box.l[0], f.box.l[1]);
                            gl.uniform2f(uni(birdProg, 'uDist'), B.near, B.far);
                            gl.uniform2f(uni(birdProg, 'uZ'), B.low, B.high);
                            gl.uniform2f(uni(birdProg, 'uSpan'), f.box.u[0], f.box.u[1]);
                            gl.uniform1f(uni(birdProg, 'uTime'), f.time);
                            gl.uniform1f(uni(birdProg, 'uSize'), B.size);
                            gl.uniform1f(uni(birdProg, 'uSpeed'), B.speed);
                            gl.uniform3fv(uni(birdProg, 'uHaze'), B.haze);
                            gl.uniform1f(uni(birdProg, 'uBat'), 0);
                            gl.uniform4f(uni(birdProg, 'uOne'), 0, 0, 0, 0);
                            gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, B.n);
                        }
                        gl.disable(gl.DEPTH_TEST);
                        gl.bindVertexArray(vao);
                    }
                    if (SX.shimmer && st.draw === null && copyColour(W, H)) {
                        gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, st.draw);
                        gl.viewport(0, 0, W, H);
                        gl.useProgram(sunxProg.p);
                        depthUniforms(sunxProg, f, W, H);
                        gl.activeTexture(gl.TEXTURE0 + PANO);
                        gl.bindTexture(gl.TEXTURE_2D, colTex);
                        gl.bindSampler(PANO, null);
                        gl.uniform1i(uni(sunxProg, 'uCol'), PANO);
                        gl.activeTexture(gl.TEXTURE0 + UNIT);
                        gl.bindTexture(gl.TEXTURE_2D, depthTex);
                        gl.uniform1f(uni(sunxProg, 'uTime'), f.time);
                        gl.uniform1f(uni(sunxProg, 'uGroundZ'), f.box.groundZ);
                        gl.uniform1f(uni(sunxProg, 'uSkyZ'), f.box.skyZ);
                        gl.uniform1f(uni(sunxProg, 'uSkyNear'), f.box.skyNear);
                        gl.uniform1f(uni(sunxProg, 'uSkyLow'), f.box.skyLow);
                        gl.uniform1f(uni(sunxProg, 'uShAmt'), SX.shimmer.amount);
                        gl.uniform1f(uni(sunxProg, 'uShH'), SX.shimmer.height);
                        gl.uniform1f(uni(sunxProg, 'uShSpeed'), SX.shimmer.speed);
                        gl.blendFuncSeparate(gl.ONE, gl.ONE_MINUS_SRC_ALPHA, gl.ZERO, gl.ONE);
                        gl.bindVertexArray(vao);
                        gl.drawArrays(gl.TRIANGLES, 0, 3);
                    }
                    gl.blendFuncSeparate(gl.ONE, gl.ONE_MINUS_SRC_ALPHA, gl.ZERO, gl.ONE);
                }
                // 2b. the lightning bolt (26g4a): the grey sky mesh drawn again with the bolt added; the roof and the town in front hide
                // it by the game's depth
                if (A && A.flash > 0.003 && A.bolt > 0 && f.boltSky && st.draw === null) {
                    const B = f.boltSky;
                    if (B.pic !== boltPic) {
                        if (boltTex !== null) gl.deleteTexture(boltTex);
                        if (boltPic !== null) picTex.delete(boltPic);
                        boltTex = uploadPicture(B.pic);
                        boltPic = B.pic;
                    }
                    gl.useProgram(boltProg.p);
                    gl.uniformMatrix4fv(uni(boltProg, 'uVP'), false, f.vp);
                    gl.uniform3fv(uni(boltProg, 'uOff'), f.offset);
                    gl.uniform3fv(uni(boltProg, 'uCam'), f.cam);
                    gl.uniform2f(uni(boltProg, 'uOut'), f.box.o[0], f.box.o[1]);
                    gl.uniform2f(uni(boltProg, 'uLat'), f.box.l[0], f.box.l[1]);
                    gl.uniform1f(uni(boltProg, 'uBolt'), A.bolt);
                    gl.uniform1f(uni(boltProg, 'uFlash'), A.flash);
                    gl.uniform1f(uni(boltProg, 'uTop'), B.top);
                    gl.activeTexture(gl.TEXTURE0 + PANO);
                    gl.bindTexture(gl.TEXTURE_2D, boltTex);
                    gl.bindSampler(PANO, null);
                    gl.uniform1i(uni(boltProg, 'uBoltTex'), PANO);
                    gl.enable(gl.DEPTH_TEST);
                    gl.depthFunc(gl.LEQUAL);
                    gl.depthMask(false);
                    gl.enable(gl.POLYGON_OFFSET_FILL);
                    gl.polygonOffset(-1, -4);
                    gl.blendFuncSeparate(gl.ONE, gl.ONE, gl.ZERO, gl.ONE);
                    for (const p of piecesOf(B.asset)) {
                        if (p.mode === 2) continue;
                        gl.bindVertexArray(p.vao);
                        gl.drawArrays(gl.TRIANGLES, 0, p.count);
                    }
                    gl.disable(gl.POLYGON_OFFSET_FILL);
                    gl.disable(gl.DEPTH_TEST);
                    gl.blendFuncSeparate(gl.ONE, gl.ONE_MINUS_SRC_ALPHA, gl.ZERO, gl.ONE);
                    gl.bindVertexArray(vao);
                    gl.activeTexture(gl.TEXTURE0 + UNIT);
                }
                // 3. rain splashes on the street (26g2)
                if (depthOk && R && R.splash > 0) {
                    gl.useProgram(splashProg.p);
                    gl.uniform1i(uni(splashProg, 'uDepth'), UNIT);
                    gl.uniformMatrix4fv(uni(splashProg, 'uInv'), false, inv);
                    gl.uniform3fv(uni(splashProg, 'uCam'), f.cam);
                    gl.uniform2f(uni(splashProg, 'uViewport'), W, H);
                    gl.uniform1f(uni(splashProg, 'uTime'), f.time);
                    gl.uniform1f(uni(splashProg, 'uRate'), R.splash);
                    gl.uniform1f(uni(splashProg, 'uBright'), R.bright);
                    gl.uniform1f(uni(splashProg, 'uWall'), f.box.wall);
                    gl.uniform2f(uni(splashProg, 'uOut'), f.box.o[0], f.box.o[1]);
                    gl.uniform3fv(uni(splashProg, 'uColor'), R.color);
                    gl.blendFuncSeparate(gl.ONE, gl.ONE_MINUS_SRC_ALPHA, gl.ZERO, gl.ONE);
                    gl.drawArrays(gl.TRIANGLES, 0, 3);
                }
                // 4. falling things, hidden by the game's depth: the rain's streaks (26g2), then the door drips (26g5)
                gl.enable(gl.DEPTH_TEST);
                gl.depthFunc(gl.LEQUAL);
                gl.depthMask(false);
                gl.blendFuncSeparate(gl.ONE, gl.ONE_MINUS_SRC_ALPHA, gl.ZERO, gl.ONE);
                gl.bindVertexArray(vao);
                if (R && R.drops > 0) {
                    gl.useProgram(streakProg.p);
                    gl.uniformMatrix4fv(uni(streakProg, 'uVP'), false, f.vp);
                    gl.uniform3fv(uni(streakProg, 'uCam'), f.cam);
                    gl.uniform2f(uni(streakProg, 'uViewport'), W, H);
                    gl.uniform1f(uni(streakProg, 'uTime'), f.time);
                    gl.uniform1f(uni(streakProg, 'uSpeed'), 5500 * R.speed);
                    gl.uniform1f(uni(streakProg, 'uLen'), R.length);
                    gl.uniform1f(uni(streakProg, 'uWind'), R.wind);
                    gl.uniform1f(uni(streakProg, 'uWidth'), 1.2 * R.width);
                    gl.uniform1f(uni(streakProg, 'uBright'), R.bright);
                    gl.uniform2f(uni(streakProg, 'uOut'), f.box.o[0], f.box.o[1]);
                    gl.uniform2f(uni(streakProg, 'uLat'), f.box.l[0], f.box.l[1]);
                    gl.uniform4f(uni(streakProg, 'uRange'), f.box.wall, R.reachEnd, f.box.u[0], f.box.u[1]);
                    gl.uniform2f(uni(streakProg, 'uZ'), f.box.z[0], f.box.z[1]);
                    gl.uniform3fv(uni(streakProg, 'uColor'), R.color);
                    gl.uniform1f(uni(streakProg, 'uDrift'), R.drift);
                    gl.uniform1f(uni(streakProg, 'uDens'), R.dens);
                    gl.uniform1f(uni(streakProg, 'uCount'), R.drops);
                    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, R.drops);
                }
                if (f.drips && f.drips.n > 0) {
                    const Dp = f.drips;
                    gl.useProgram(dripProg.p);
                    gl.uniformMatrix4fv(uni(dripProg, 'uVP'), false, f.vp);
                    gl.uniform3fv(uni(dripProg, 'uCam'), f.cam);
                    gl.uniform2f(uni(dripProg, 'uViewport'), W, H);
                    gl.uniform1f(uni(dripProg, 'uTime'), f.time);
                    gl.uniform1f(uni(dripProg, 'uG'), Dp.g);
                    gl.uniform1f(uni(dripProg, 'uTop'), Dp.top);
                    gl.uniform1f(uni(dripProg, 'uGround'), Dp.ground);
                    gl.uniform1f(uni(dripProg, 'uAt'), Dp.at);
                    gl.uniform1f(uni(dripProg, 'uWidth'), Dp.width);
                    gl.uniform1f(uni(dripProg, 'uBright'), Dp.bright);
                    gl.uniform1f(uni(dripProg, 'uWind'), Dp.wind);
                    gl.uniform1f(uni(dripProg, 'uSplash'), Dp.splash);
                    gl.uniform2f(uni(dripProg, 'uOut'), f.box.o[0], f.box.o[1]);
                    gl.uniform2f(uni(dripProg, 'uLat'), f.box.l[0], f.box.l[1]);
                    gl.uniform2f(uni(dripProg, 'uSpan'), Dp.span[0], Dp.span[1]);
                    gl.uniform3fv(uni(dripProg, 'uColor'), Dp.color);
                    gl.enable(gl.POLYGON_OFFSET_FILL);
                    gl.polygonOffset(-1, -4);
                    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, Dp.n);
                    gl.disable(gl.POLYGON_OFFSET_FILL);
                }
                // the door's icicles (26j)
                if (f.swx && f.swx.ice) {
                    const I = f.swx.ice;
                    gl.useProgram(iceProg.p);
                    gl.uniformMatrix4fv(uni(iceProg, 'uVP'), false, f.vp);
                    gl.uniform3fv(uni(iceProg, 'uCam'), f.cam);
                    gl.uniform2f(uni(iceProg, 'uOut'), f.box.o[0], f.box.o[1]);
                    gl.uniform2f(uni(iceProg, 'uLat'), f.box.l[0], f.box.l[1]);
                    gl.uniform2f(uni(iceProg, 'uSpan'), I.span[0], I.span[1]);
                    gl.uniform1f(uni(iceProg, 'uTop'), I.top);
                    gl.uniform1f(uni(iceProg, 'uAt'), I.at);
                    gl.uniform1f(uni(iceProg, 'uLen'), I.len);
                    gl.uniform1f(uni(iceProg, 'uWidth'), I.width);
                    gl.uniform1f(uni(iceProg, 'uN'), I.n);
                    gl.uniform3fv(uni(iceProg, 'uColor'), I.color);
                    gl.uniform1f(uni(iceProg, 'uTime'), f.time);
                    gl.uniform1f(uni(iceProg, 'uGlint'), I.glint);
                    const wasCull = gl.isEnabled(gl.CULL_FACE);
                    gl.disable(gl.CULL_FACE);
                    gl.drawArraysInstanced(gl.TRIANGLES, 0, 3, I.n);
                    if (wasCull) gl.enable(gl.CULL_FACE);
                }
                // falling and floating specks, the probe's flakes(): mode 0 = the snow outside, 2 = the snow blown inside, 1 = the dust
                // in the hangar's light (26h); the snow's drift and gust move every mode, the street lamps light only the snow outside
                const reachEnd = (reach: number): number => Math.min(f.box.far, f.box.wall + reach);
                const flakes = (
                    mode: number,
                    n: number,
                    sp: number,
                    size: number,
                    wind: number,
                    sway: number,
                    bright: number,
                    color: readonly number[],
                    alphaMul: number,
                    reach: number,
                ): void => {
                    gl.useProgram(flakeProg.p);
                    gl.uniformMatrix4fv(uni(flakeProg, 'uVP'), false, f.vp);
                    gl.uniform3fv(uni(flakeProg, 'uCam'), f.cam);
                    gl.uniform2f(uni(flakeProg, 'uViewport'), W, H);
                    gl.uniform1f(uni(flakeProg, 'uTime'), f.time);
                    gl.uniform1f(uni(flakeProg, 'uSpeed'), sp);
                    gl.uniform1f(uni(flakeProg, 'uSize'), size);
                    gl.uniform1f(uni(flakeProg, 'uWind'), wind);
                    gl.uniform1f(uni(flakeProg, 'uDrift'), f.snow ? f.snow.drift : 0);
                    gl.uniform1f(uni(flakeProg, 'uGust'), f.snow ? f.snow.gust : 0);
                    const LG = mode === 0 && f.snow ? f.snow.glow : null;
                    gl.uniform1i(uni(flakeProg, 'uLampN'), LG ? LG.n : 0);
                    gl.uniform3fv(uni(flakeProg, 'uLampCol'), LG ? LG.color : [0, 0, 0]);
                    if (LG) {
                        gl.uniform1f(uni(flakeProg, 'uLampStart'), LG.start);
                        gl.uniform1f(uni(flakeProg, 'uLampGap'), LG.gap);
                        gl.uniform1f(uni(flakeProg, 'uLampZ'), LG.z);
                        gl.uniform1f(uni(flakeProg, 'uLampR'), LG.r);
                        gl.uniform1f(uni(flakeProg, 'uLampGlow'), LG.amount);
                        gl.uniform2f(uni(flakeProg, 'uLampSides'), LG.sides[0], LG.sides[1]);
                    }
                    gl.uniform1f(uni(flakeProg, 'uSway'), sway);
                    gl.uniform1f(uni(flakeProg, 'uBright'), bright);
                    gl.uniform1i(uni(flakeProg, 'uMode'), mode);
                    gl.uniform2f(uni(flakeProg, 'uOut'), f.box.o[0], f.box.o[1]);
                    gl.uniform2f(uni(flakeProg, 'uLat'), f.box.l[0], f.box.l[1]);
                    gl.uniform4f(uni(flakeProg, 'uRange'), f.box.wall, reachEnd(reach || 5000), f.box.u[0], f.box.u[1]);
                    gl.uniform2f(uni(flakeProg, 'uZ'), f.box.z[0], f.box.z[1]);
                    gl.uniform3fv(uni(flakeProg, 'uRoomMin'), f.box.roomMin);
                    gl.uniform3fv(uni(flakeProg, 'uRoomMax'), f.box.roomMax);
                    gl.uniform3fv(uni(flakeProg, 'uColor'), color);
                    gl.uniform1f(uni(flakeProg, 'uAlphaMul'), alphaMul);
                    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, n);
                };
                if (f.snow && f.snow.flakes > 0)
                    flakes(0, f.snow.flakes, 160 * f.snow.speed, f.snow.size, f.snow.wind, f.snow.sway, f.snow.bright, f.snow.color, 1, f.snow.reach);
                if (f.snowIn)
                    flakes(2, f.snowIn.n, 160 * f.snowIn.speed, f.snowIn.size, f.snowIn.wind, f.snowIn.sway, f.snowIn.bright, f.snowIn.color, 0.8, 0);
                if (f.motes && f.motes.n > 0) flakes(1, f.motes.n, 0, 1, 0, 0, f.motes.bright, f.motes.color, 0.25, 0);
                gl.disable(gl.DEPTH_TEST);
                // 5. the waiting room, the launch lift, while the game searches (26d step 10), last, over everything but the tank and its
                // platform
                if (depthOk && f.room && roomProg) {
                    const Rm = f.room;
                    const pr = roomProg;
                    gl.bindVertexArray(vao);
                    gl.activeTexture(gl.TEXTURE0 + UNIT);
                    gl.bindTexture(gl.TEXTURE_2D, depthTex);
                    gl.bindSampler(UNIT, null);
                    gl.useProgram(pr.p);
                    depthUniforms(pr, f, W, H);
                    gl.uniform3fv(uni(pr, 'uBase'), Rm.base);
                    gl.uniform3fv(uni(pr, 'uBeamCol'), Rm.beamCol);
                    gl.uniform2fv(uni(pr, 'uBeamDir'), Rm.beamDir);
                    gl.uniform1f(uni(pr, 'uW'), Rm.width);
                    gl.uniform1f(uni(pr, 'uRise'), Rm.rise);
                    gl.uniform1f(uni(pr, 'uR'), Rm.radius);
                    gl.uniform1f(uni(pr, 'uFloor'), Rm.floor);
                    gl.uniform1f(uni(pr, 'uRow'), Rm.row);
                    gl.uniform1f(uni(pr, 'uDeck'), Rm.deck);
                    gl.uniform4fv(uni(pr, 'uDrone'), Rm.drone);
                    gl.uniform1f(uni(pr, 'uTop'), Rm.top);
                    gl.uniform1f(uni(pr, 'uSoft'), Rm.soft);
                    gl.uniform1f(uni(pr, 'uAmt'), Rm.amount);
                    if (Rm.logo !== null && Rm.logo !== logoPic) {
                        logoTex = uploadPicture(Rm.logo);
                        logoPic = Rm.logo;
                        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
                        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
                    }
                    gl.activeTexture(gl.TEXTURE0 + PANO);
                    gl.bindTexture(gl.TEXTURE_2D, logoTex);
                    gl.bindSampler(PANO, null);
                    gl.uniform1i(uni(pr, 'uLogo'), PANO);
                    gl.uniform1f(uni(pr, 'uHasLogo'), logoTex !== null ? 1 : 0);
                    gl.blendFuncSeparate(gl.ONE, gl.ONE_MINUS_SRC_ALPHA, gl.ZERO, gl.ONE);
                    gl.drawArrays(gl.TRIANGLES, 0, 3);
                }
            } finally {
                restore(st);
            }
        }

        function dispose(): void {
            if (gl.isContextLost()) return;
            for (const p of programs) gl.deleteProgram(p);
            gl.deleteVertexArray(vao);
            if (depthTex !== null) gl.deleteTexture(depthTex);
            if (depthFbo !== null) gl.deleteFramebuffer(depthFbo);
            if (colTex !== null) gl.deleteTexture(colTex);
            if (colFbo !== null) gl.deleteFramebuffer(colFbo);
            for (const list of pieceCache.values()) for (const p of list) gl.deleteVertexArray(p.vao);
            if (sheet !== null) gl.deleteVertexArray(sheet);
            for (const b of pieceBufs) gl.deleteBuffer(b);
            // (the bolt's texture is in picTex too)
            for (const t of picTex.values()) gl.deleteTexture(t);
            for (const m of groundMaps.values()) gl.deleteTexture(m.tex);
        }

        return { draw, dispose, siren: () => ({ program: sirenState, drawn: sirenDrawn }) };
    }

    // The Halloween hangar's lamp heads (its room0 faces round the four ring lamp spots) and their light cones (transp1), as the probe's
    // ensureLampFixtures (v1.20): the owner's "Halloween lamps", lit over the standard ring lamps at night.
    async function loadFixtures(base: string, lamps: ReadonlyArray<readonly number[]>): Promise<KaspLobbyAsset> {
        const spots = lamps.length > 0 ? lamps : [[100, 207, 403], [-104, 207, 403], [100, -205, 403], [-104, -205, 403]];
        const keep: Keep = (name, c) => name !== 'room0' || spots.some((l) => Math.hypot(c[0] - l[0], c[1] - l[1]) < 75 && Math.abs(c[2] - l[2] - 7) < 40);
        const model = await sharedModel(base + 'halloween2024-object.3ds');
        const batches = batchesOf(model, ['room0', 'transp1'], (pic) => base + 'halloween2024-' + encodeURIComponent(pic), keep);
        return { key: 'halloween-lamps', batches, pics: await pictures(batches) };
    }

    // A seasonal outside (26k, the probe's ensureSeason): the season hangar's sky, town and its mist pieces; its ground just outside the
    // door for the floor blend (the town's flat, upward faces near the ground: no trees, no roofs); and, as its sky picture is one flat
    // sheet that ends where the game's own camera stops looking, a mirrored copy at each end that carries the sheet on seamlessly.
    async function loadSeason(base: string, season: string): Promise<KaspLobbySeason> {
        const fileOf = (pic: string): string => base + season + '-' + encodeURIComponent(pic);
        const model = await sharedModel(base + season + '-object.3ds');
        const batches = batchesOf(model, ['Sky0', 'bg0', 'transp2', 'transp3'], fileOf);
        const pics = await pictures(batches);
        const ground: KaspLobbyAsset = {
            key: season + ':ground',
            batches: batchesOf(model, ['bg0'], fileOf, (_name, _c, n, zTop) => zTop < 160 && Math.abs(n[2]) > 0.6).filter((b) => b.mode !== 2),
            pics,
        };
        const skyCopies: KaspLobbyAsset[] = [];
        const skyB = batches.filter((b) => b.name === 'Sky0');
        if (skyB.length > 0) {
            const xy: Array<[number, number]> = [];
            for (const b of skyB) for (let i = 0; i < b.pos.length; i += 3) xy.push([b.pos[i], b.pos[i + 1]]);
            let A = xy[0];
            let B = xy[0];
            let far = -1;
            for (const Pt of xy)
                for (const Q of xy) {
                    const d = Math.hypot(Pt[0] - Q[0], Pt[1] - Q[1]);
                    if (d > far) {
                        far = d;
                        A = Pt;
                        B = Q;
                    }
                }
            for (const [E, O] of [
                [A, B],
                [B, A],
            ]) {
                const len = Math.hypot(E[0] - O[0], E[1] - O[1]) || 1;
                const nx = (E[0] - O[0]) / len;
                const ny = (E[1] - O[1]) / len;
                const k = 2 * (E[0] * nx + E[1] * ny);
                skyCopies.push({
                    key: season + ':sky-mirror-' + skyCopies.length,
                    batches: skyB,
                    pics,
                    xr: [1 - 2 * nx * nx, -2 * nx * ny, -2 * nx * ny, 1 - 2 * ny * ny],
                    xs: 1,
                    xt: [k * nx, k * ny, 0],
                });
            }
        }
        return { asset: { key: season, batches, pics, skyCopies }, ground };
    }
    // The Halloween hangar's pumpkins (26k, the probe's ensureHwPumpkins: its "pumpkins" piece, at its own places round the floor) and a
    // candle in each (the middle of each pumpkin, grouped from its faces; small leftover bits are skipped).
    async function loadPumpkins(base: string): Promise<KaspLobbyPumpkins> {
        const model = await sharedModel(base + 'halloween2024-object.3ds');
        const batches = batchesOf(model, ['pumpkins'], (pic) => base + 'halloween2024-' + encodeURIComponent(pic));
        const asset: KaspLobbyAsset = { key: 'halloween-pumpkins', batches, pics: await pictures(batches) };
        const groups: Array<{ s: number[]; n: number; lo: number; hi: number }> = [];
        for (const b of batches) {
            const Ps = b.pos;
            for (let t = 0; t < Ps.length / 9; t++) {
                const c = [0, 1, 2].map((k) => (Ps[t * 9 + k] + Ps[t * 9 + 3 + k] + Ps[t * 9 + 6 + k]) / 3);
                let g = groups.find((q) => Math.hypot(q.s[0] / q.n - c[0], q.s[1] / q.n - c[1]) < 90);
                if (g === undefined) {
                    g = { s: [0, 0, 0], n: 0, lo: 1e9, hi: -1e9 };
                    groups.push(g);
                }
                for (let k = 0; k < 3; k++) g.s[k] += c[k];
                g.n++;
                g.lo = Math.min(g.lo, c[2]);
                g.hi = Math.max(g.hi, c[2]);
            }
        }
        const candles = groups.filter((g) => g.n >= 20 && g.hi - g.lo > 40).map((g) => [g.s[0] / g.n, g.s[1] / g.n, g.lo + (g.hi - g.lo) * 0.45]);
        return { asset, candles };
    }

    // The Christmas hangar's two trees (26l, the probe's ensureXmTree: its Pine and Pine_Big, made round the middle of its room, so the
    // look moves the one it uses to the tree's spot) and how far each reaches.
    async function loadTrees(base: string): Promise<KaspLobbyTrees> {
        const model = await sharedModel(base + 'newyear2025-object.3ds');
        const fileOf = (pic: string): string => base + 'newyear2025-' + encodeURIComponent(pic);
        const piece = async (key: string, name: string): Promise<KaspLobbyAsset> => {
            const batches = batchesOf(model, [name], fileOf);
            return { key, batches, pics: await pictures(batches) };
        };
        const boundsOf = (a: KaspLobbyAsset): KaspLobbyBounds => {
            const lo = [1e9, 1e9, 1e9];
            const hi = [-1e9, -1e9, -1e9];
            for (const b of a.batches)
                for (let i = 0; i < b.pos.length; i += 3)
                    for (let k = 0; k < 3; k++) {
                        lo[k] = Math.min(lo[k], b.pos[i + k]);
                        hi[k] = Math.max(hi[k], b.pos[i + k]);
                    }
            return { lo, hi };
        };
        const [pine, pineBig] = await Promise.all([piece('xmas-pine', 'Pine'), piece('xmas-pine-big', 'Pine_Big')]);
        return { pine, pineBig, bounds: { pine: boundsOf(pine), pineBig: boundsOf(pineBig) } };
    }

    // The Christmas hangar's own fireplace (26l, the probe's v1.88 ensureXmFire): the pieces of its room (vertices welded at the same
    // place, faces sharing one joined) lying wholly inside one of these boxes (the New Year room's own places): the fireplace with its
    // grate, logs, stockings and mantel things, and its chimney; the log pile beside it; the rug in front. FIREPLACE_PIVOT = the
    // fireplace's back middle on the floor.
    const FIREPLACE_BOXES: Readonly<Record<'fire' | 'logs' | 'rug', ReadonlyArray<readonly [readonly number[], readonly number[]]>>> = {
        fire: [
            [[-1500, -1030, -15], [-1290, -570, 360]],
            [[-1500, -885, 280], [-1360, -710, 1075]],
        ],
        logs: [[[-1510, -1245, -5], [-1295, -980, 165]]],
        rug: [[[-1470, -1100, -12], [-930, -555, 10]]],
    };
    const FIREPLACE_PIVOT = [-1484, -798];
    // skip = boxes whose pieces are left out (a log of the pile also fits the fireplace's box; it belongs to the pile)
    function roomPieceFaces(
        room: ModelObject,
        boxes: ReadonlyArray<readonly [readonly number[], readonly number[]]>,
        skip: ReadonlyArray<readonly [readonly number[], readonly number[]]> = [],
    ): Set<number> {
        const V = room.v;
        const Fc = room.f;
        const set = new Set<number>();
        if (V === null || Fc === null) return set;
        const nF = Fc.length / 3;
        const place = new Map<string, number>();
        const weld = new Int32Array(V.length / 3);
        for (let i = 0; i < weld.length; i++) {
            const k = `${Math.round(V[i * 3] * 10)},${Math.round(V[i * 3 + 1] * 10)},${Math.round(V[i * 3 + 2] * 10)}`;
            let at = place.get(k);
            if (at === undefined) {
                at = place.size;
                place.set(k, at);
            }
            weld[i] = at;
        }
        const par = Array.from({ length: place.size }, (_, i) => i);
        const root = (x: number): number => {
            while (par[x] !== x) {
                par[x] = par[par[x]];
                x = par[x];
            }
            return x;
        };
        for (let f = 0; f < nF; f++) {
            const a = root(weld[Fc[f * 3]]);
            par[root(weld[Fc[f * 3 + 1]])] = a;
            par[root(weld[Fc[f * 3 + 2]])] = a;
        }
        const info = new Map<number, { faces: number[]; lo: number[]; hi: number[] }>();
        for (let f = 0; f < nF; f++) {
            const r = root(weld[Fc[f * 3]]);
            let p = info.get(r);
            if (p === undefined) {
                p = { faces: [], lo: [1e9, 1e9, 1e9], hi: [-1e9, -1e9, -1e9] };
                info.set(r, p);
            }
            p.faces.push(f);
            for (let k = 0; k < 3; k++)
                for (let a = 0; a < 3; a++) {
                    const v = V[Fc[f * 3 + k] * 3 + a];
                    p.lo[a] = Math.min(p.lo[a], v);
                    p.hi[a] = Math.max(p.hi[a], v);
                }
        }
        const within = (p: { lo: number[]; hi: number[] }, list: ReadonlyArray<readonly [readonly number[], readonly number[]]>): boolean =>
            list.some(([a, b]) => p.lo.every((v, i) => v >= a[i]) && p.hi.every((v, i) => v <= b[i]));
        for (const p of info.values()) if (within(p, boxes) && !within(p, skip)) for (const f of p.faces) set.add(f);
        return set;
    }
    async function loadFireplace(base: string): Promise<KaspLobbyFireplace> {
        const model = await sharedModel(base + 'newyear2025-object.3ds');
        const fileOf = (pic: string): string => base + 'newyear2025-' + encodeURIComponent(pic);
        const room = model.objects.find((o) => o.name === 'room0');
        if (room === undefined) throw new Error('no room in the New Year model');
        const asset = async (
            key: string,
            boxes: ReadonlyArray<readonly [readonly number[], readonly number[]]>,
            skip: ReadonlyArray<readonly [readonly number[], readonly number[]]> = [],
        ): Promise<KaspLobbyAsset> => {
            const set = roomPieceFaces(room, boxes, skip);
            const only: Model = { objects: [{ ...room, groups: room.groups.map((g) => ({ ...g, faces: g.faces.filter((f) => set.has(f)) })) }], materials: model.materials };
            const batches = batchesOf(only, ['room0'], fileOf);
            return { key, batches, pics: await pictures(batches) };
        };
        const [fire, logs, rug] = await Promise.all([
            asset('xmas-fireplace', FIREPLACE_BOXES.fire, FIREPLACE_BOXES.logs),
            asset('xmas-fireplace-logs', FIREPLACE_BOXES.logs),
            asset('xmas-fireplace-rug', FIREPLACE_BOXES.rug),
        ]);
        return { fire, logs, rug, pivot: FIREPLACE_PIVOT };
    }

    window.__kaspLobbyPass = { make, loadStandard, nightPictures, loadFixtures, lensPictures, loadSky, loadSeason, loadPumpkins, loadTrees, loadFireplace };
})();
