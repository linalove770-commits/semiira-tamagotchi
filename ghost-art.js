/* Original reference-based neutral plus GPT Image2 expressions. Everything local.
   Generated sheet is not an exact grid: crop boundaries were visually verified. */
(() => {
let original=null,expressions=null,bowLayer=null,bodyLayer=null;const source=new Image(),sheet=new Image();
function keyed(image){const c=document.createElement('canvas');c.width=image.naturalWidth;c.height=image.naturalHeight;const x=c.getContext('2d',{willReadFrequently:true});x.drawImage(image,0,0);const data=x.getImageData(0,0,c.width,c.height),p=data.data;for(let i=0;i<p.length;i+=4){const r=p[i],g=p[i+1],b=p[i+2],excess=g-Math.max(r,b);if(g>95&&excess>48)p[i+3]=0;else if(excess>12&&g>85){p[i+1]=Math.max(r,b);p[i+3]=Math.round(p[i+3]*Math.max(0,1-(excess-12)/36));}}x.putImageData(data,0,0);return c;}
source.onload=()=>{try{original=keyed(source);bodyLayer=document.createElement('canvas');bodyLayer.width=original.width;bodyLayer.height=original.height;const bx=bodyLayer.getContext('2d');bx.drawImage(original,0,0);bowLayer=document.createElement('canvas');bowLayer.width=original.width;bowLayer.height=original.height;const bl=bowLayer.getContext('2d'),bd=bx.getImageData(0,0,original.width,original.height),only=bl.createImageData(original.width,original.height);for(let y=0;y<320;y++)for(let x=360;x<895;x++){const i=(y*original.width+x)*4,r=bd.data[i],g=bd.data[i+1],b=bd.data[i+2];if(r>g*1.2&&b>g*1.1&&bd.data[i+3]){for(let k=0;k<4;k++)only.data[i+k]=bd.data[i+k];bd.data[i+3]=0;}}bx.putImageData(bd,0,0);bl.putImageData(only,0,0);window.SemiiraArt.ready=true;}catch(e){console.error('Mascot processing failed',e);}};
source.onerror=()=>console.error('Mascot source unavailable');
sheet.onload=()=>{try{const clean=keyed(sheet),boxes=[[54,24,467,502],[527,24,455,502],[995,24,460,502],[54,531,467,493],[527,531,455,493],[995,531,460,493]];expressions=boxes.map(([x,y,w,h])=>{const c=document.createElement('canvas');c.width=512;c.height=544;const k=c.getContext('2d');k.drawImage(clean,x,y,w,h,(512-w)/2,(544-h)/2,w,h);return c;});window.SemiiraArt.emotionsReady=true;}catch(e){console.error('Emotion sheet processing failed',e);}};
sheet.onerror=()=>console.warn('Emotion sheet unavailable; reference neutral retained');
window.SemiiraArt={ready:false,emotionsReady:false,currentEmotion:'neutral',draw(ctx,x,y,scale,pose,time,reduced,details={}){if(!original)return;
let emotion='neutral',index=-1;
if(pose==='sleep'){emotion='sleep';index=2;}
else if(pose==='food'){emotion='eating';index=5;}
else if(pose==='wake'){emotion='surprised';index=3;}
else if(pose==='grumpy'){emotion='grumpy';index=4;}
else if(pose==='bath'){emotion='grumpy';index=4;}
else if(pose==='bow'||pose==='celebrate'||pose==='happy'){emotion='happy';index=1;}
this.currentEmotion=emotion;
ctx.save();ctx.translate(x,y);const bob=reduced||pose==='bow'?0:Math.sin(time*(pose==='food'?5:2.2))*.65;ctx.translate(0,bob);ctx.scale(scale,scale);ctx.rotate(pose==='sleep'?-.035:0);ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality='high';
if(details.look&&details.look!=='none'&&pose!=='bath'&&window.SemiiraLooks?.draw(ctx,details.look,pose,time,reduced,details)){ctx.restore();return;}
if(bodyLayer&&(pose==='bow'||(details.messy&&pose==='idle'))){
// Move only the real pink bow pixels; cloth, eyes and exactly two tails stay fixed.
ctx.drawImage(bodyLayer,75,47,1100,1170,-44,-51,88,93.6);
const p=reduced?1:Math.min(1,Math.max(0,details.progress||0)),groom=pose==='bow';
const angle=reduced?0:groom?(1-p)*(.19+Math.sin(p*Math.PI*4)*.09):.19;
const lift=groom&&!reduced?Math.sin(p*Math.PI)*3:0;
ctx.save();ctx.translate(.16,-39.5-lift);ctx.rotate(angle);ctx.scale(groom?1+Math.sin(p*Math.PI)*.14:1,1);ctx.translate(-.16,39.5);
ctx.drawImage(bowLayer,75,47,1100,1170,-44,-51,88,93.6);ctx.restore();
}else if(index>=0&&expressions)ctx.drawImage(expressions[index],-47,-52,94,99.9);else ctx.drawImage(original,75,47,1100,1170,-44,-51,88,93.6);
if(window.SemiiraClothes&&details.clothes){ctx.save();if(index>=0&&expressions&&pose!=='bow'){ctx.translate(0,1.5);ctx.scale(.96,.96);}SemiiraClothes.draw(ctx,details.clothes,pose);ctx.restore();}
ctx.restore();},getSourceSize:()=>original?{width:original.width,height:original.height}:null};
source.src=window.SEMIIRA_SPRITE_SOURCE||'';sheet.src=window.SEMIIRA_EMOTIONS_SOURCE||'';
})();
