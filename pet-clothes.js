/* Layered clothing in the accepted sprite's logical coordinate system.
   Never paints on eyes/bow or replaces the two existing ribbon tails. */
window.SemiiraClothes={draw(ctx,outfit={},pose='idle'){
if(pose==='bath')return;ctx.save();
const path=(points,fill,stroke)=>{ctx.beginPath();points.forEach((p,i)=>i?ctx.lineTo(...p):ctx.moveTo(...p));ctx.closePath();ctx.fillStyle=fill;ctx.fill();if(stroke){ctx.strokeStyle=stroke;ctx.lineWidth=.7;ctx.stroke();}};
const cape=outfit.cape;
if(['capeNight','capeRose','capeRain'].includes(cape)){
const palette={capeNight:['#493b72','#b6a4da','#f1d8a1'],capeRose:['#bc779c','#f0bdd6','#fff0f7'],capeRain:['#9c9acc','#e1e3ff','#eae2ff']}[cape];
// Split front panels leave central drape and bottom lace uncovered.
const length=cape==='capeRain'?28:cape==='capeRose'?17:25;
for(const side of[-1,1]){const pts=[[side*13,-5],[side*17,1],[side*23,15],[side*28,length],[side*17,length+2],[side*8,8],[side*5,-2]];const grad=ctx.createLinearGradient(side*6,0,side*26,15);grad.addColorStop(0,palette[1]);grad.addColorStop(.25,palette[0]);grad.addColorStop(1,palette[1]);path(pts,grad,palette[0]);ctx.strokeStyle=palette[1];ctx.lineWidth=.8;ctx.beginPath();ctx.moveTo(side*12,0);ctx.lineTo(side*19,17);ctx.stroke();}
ctx.fillStyle=palette[2];ctx.beginPath();ctx.ellipse(0,-.5,2,1.7,0,0,Math.PI*2);ctx.fill();
if(cape==='capeNight'){for(const [x,y]of[[-17,9],[-22,20],[17,8],[23,19]]){ctx.fillRect(x-.5,y-2,1,4);ctx.fillRect(x-2,y-.5,4,1);}}
if(cape==='capeRose'){for(const side of[-1,1])for(let i=0;i<7;i++){ctx.fillStyle='#fce6f2';ctx.beginPath();ctx.arc(side*(15+i*1.8),16+i*.25,1.4,0,Math.PI*2);ctx.fill();}}
if(cape==='capeRain'){for(const side of[-1,1]){path([[side*17,12],[side*23,13],[side*24,20],[side*19,19]],'#8587bb','#d3d4f3');}ctx.fillStyle='#eae2ff';for(let i=0;i<3;i++)ctx.fillRect(-1,5+i*5,2,2);}
}
if(outfit.neck==='scarfRose'||outfit.neck==='scarfMint'){
const mint=outfit.neck==='scarfMint',base=mint?'#77b7af':'#d888af',light=mint?'#c6e9dd':'#f9c5df',dark=mint?'#4c8c8e':'#a45c8c';
path([[-15,-5],[-9,-2],[8,-2],[15,-5],[14,2],[6,5],[-7,5],[-14,2]],base,dark);
path([[7,2],[14,1],[17,16],[12,20],[7,16]],base,dark);
ctx.strokeStyle=light;ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(-12,-1);ctx.quadraticCurveTo(0,5,12,-1);ctx.stroke();for(let j=0;j<3;j++){ctx.beginPath();ctx.moveTo(9+j*2,16);ctx.lineTo(10+j*2,20);ctx.stroke();}ctx.fillStyle=light;ctx.fillRect(10,8,5,1.5);
}else if(outfit.neck==='collarPearl'){for(let i=0;i<11;i++){const x=-14+i*2.8,y=-2+Math.sin(i/10*Math.PI)*5;ctx.fillStyle=i%2?'#f9f2f7':'#d7ccdf';ctx.beginPath();ctx.arc(x,y,1.7,0,Math.PI*2);ctx.fill();ctx.fillStyle='#fff';ctx.fillRect(x-.6,y-.8,.6,.6);}path([[0,4],[2.5,7],[0,10],[-2.5,7]],'#c392c0','#936489');}
ctx.restore();}};
