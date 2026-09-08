/* GPT Image2 full dressed sprites. Neutral is generated; eye animation is compositing,
   not a claim of separately generated emotion sheets. Outfit and bow never disappear. */
(() => {const looks={};const canvas=()=>{const c=document.createElement('canvas');c.width=c.height=1254;return c;};
function prepare(im){const base=canvas(),x=base.getContext('2d',{willReadFrequently:true});x.drawImage(im,0,0,1254,1254);const body=canvas(),bow=canvas(),bx=body.getContext('2d'),wx=bow.getContext('2d');const data=x.getImageData(0,0,1254,1254),only=wx.createImageData(1254,1254);
// Keep head's bright near-neutral cloth on body. Transfer colored bow and all jewelry
// above crown; include dark lace outline. Tail attachment below340 stays on body.
for(let y=25;y<340;y++)for(let xx=350;xx<900;xx++){const i=(y*1254+xx)*4,r=data.data[i],g=data.data[i+1],b=data.data[i+2];if(data.data[i+3]&&(y<232||r-g>22||Math.min(r,g,b)<165)){for(let k=0;k<4;k++)only.data[i+k]=data.data[i+k];data.data[i+3]=0;}}bx.putImageData(data,0,0);wx.putImageData(only,0,0);
const closed=canvas(),cx=closed.getContext('2d');cx.drawImage(base,0,0);
// Replace each eye with adjacent unadorned cloth scanline; generated clothes begin lower.
for(const [left,right]of[[520,590],[661,730]])for(let y=373;y<535;y++)cx.drawImage(base,left-13,y,5,1,left,y,right-left,1);
return{base,body,bow,closed};}
const api=window.SemiiraLooks={ready:false,count:0,has:id=>!!looks[id],draw(ctx,id,pose,time,reduced,details={}){const s=looks[id];if(!s)return false;
const draw=c=>ctx.drawImage(c,75,47,1100,1170,-44,-51,88,93.6);
if(pose==='bow'||(details.messy&&pose==='idle')){draw(s.body);const p=reduced?1:Math.max(0,Math.min(1,details.progress||0)),moving=pose==='bow';ctx.save();ctx.translate(.16,-39.5-(moving?Math.sin(p*Math.PI)*3:0));ctx.rotate(reduced?0:moving?(1-p)*(.19+Math.sin(p*Math.PI*4)*.09):.19);ctx.scale(moving?1+Math.sin(p*Math.PI)*.12:1,1);ctx.translate(-.16,39.5);draw(s.bow);ctx.restore();return true;}
const happy=['happy','celebrate','food'].includes(pose),sleep=pose==='sleep';draw(happy||sleep?s.closed:s.base);
if(happy||sleep){ctx.strokeStyle='#25182e';ctx.lineWidth=1.5;ctx.lineCap='round';for(const e of[-5.7,5.6]){ctx.beginPath();ctx.moveTo(e-2,-19);ctx.quadraticCurveTo(e,sleep?-17:-23,e+2,-19);ctx.stroke();}}
return true;}};
Promise.all(Object.entries(window.SEMIIRA_LOOK_SOURCES||{}).map(async([id,src])=>{const im=new Image();im.src=src;await im.decode();looks[id]=prepare(im);api.count++;})).then(()=>{api.ready=api.count===7;}).catch(e=>console.error('Generated outfits unavailable',e.message));})();
