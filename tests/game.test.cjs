const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
const elements = new Map();
const eventHandlers = new Map();
const storage = new Map();
const painter = new Proxy({}, { get: (target, property) => property === 'createLinearGradient' ? () => ({ addColorStop() {} }) : target[property] || (() => {}), set: (target, property, value) => { target[property] = value; return true; } });
function element(id) {
 if (!elements.has(id)) elements.set(id, { id, tagName:'DIV', style:{}, dataset:{}, textContent:'', innerHTML:'', hidden:false, disabled:false, classList:{add(){},remove(){}}, setAttribute(){}, addEventListener(){}, getContext:()=>painter, getBoundingClientRect:()=>({width:1120,height:496}), focus(){}, scrollIntoView(){} });
 return elements.get(id);
}
const sandbox = {
 console, Math, Set, Map,
 document:{getElementById:element,querySelectorAll:()=>[],createElement:()=>element('generated'+elements.size),addEventListener:(name,handler)=>eventHandlers.set('document:'+name,handler)},
 window:{addEventListener:(name,handler)=>eventHandlers.set(name,handler)},
 localStorage:{getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,value)},
 ResizeObserver:class{observe(){}},
 setTimeout:()=>1,clearTimeout(){},requestAnimationFrame(){}
};
const exposed = `globalThis.game = {startGame,loadLevel,buildLevel,showPause,resumeGame,showTitle,hitBlock,gainPower,hurtPlayer,respawn,fireball,damageBoss,finishLevel,collectCoin,update,render,persist,resetInput,pressed,syncInput,controls,get player(){return player},get level(){return level},get pickups(){return pickups},get projectiles(){return projectiles},get save(){return save},get stats(){return {state,score,coins,lives,timeLeft,checkpoint,levelCoins,worldIndex}},setPosition(positionX,positionY){player.x=positionX;player.y=positionY;player.vx=0;player.vy=0;player.grounded=false;},setInvulnerable(){player.star=1000;},jump(){jumpBuffer=.15;controls.jump=true;}};`;
vm.runInNewContext(script.replace(/\}\)\(\);\s*$/,exposed+'})();'),sandbox);
const game=sandbox.game;
let passed=0;
function test(name,callback){try{callback();passed++;console.log('PASS '+name);}catch(error){console.error('FAIL '+name);throw error;}}
function step(seconds){for(let frame=0;frame<Math.ceil(seconds*120);frame++)game.update(1/120);}
function restart(index=0){game.startGame(index);game.resetInput();}

test('single HTML has no external asset dependencies',()=>{assert(!/<script[^>]+src=|<link[^>]+href=|<img[^>]+src=|url\(\s*https?:/i.test(html));});
test('initial title and four authored levels',()=>{assert.equal(game.stats.state,'title');for(let index=0;index<4;index++){const level=game.buildLevel(index);assert(level.grounds.length>=5);assert(level.blocks.length>=20);assert(level.coins.length>=30);assert(level.flag<level.width);assert(level.grounds.some(ground=>ground.x<=level.checkpoint&&ground.x+ground.w>=level.checkpoint+28));}});
test('starts with three lives and 300 seconds',()=>{restart();assert.equal(game.stats.lives,3);assert.equal(game.stats.timeLeft,300);assert.equal(game.stats.state,'playing');});
test('gravity keeps standing player on floor',()=>{step(1);assert.equal(game.player.y+game.player.h,416);assert(game.player.grounded);});
test('movement accelerates and releases cleanly',()=>{game.controls.right=true;step(.5);assert(game.player.x>180);game.controls.right=false;step(.3);assert.equal(game.player.vx,0);});
test('held jump is higher than short tap',()=>{restart();game.jump();step(.02);game.controls.jump=false;let tapTop=416;for(let frame=0;frame<100;frame++){game.update(1/120);tapTop=Math.min(tapTop,game.player.y);}restart();game.jump();let holdTop=416;for(let frame=0;frame<100;frame++){game.update(1/120);holdTop=Math.min(holdTop,game.player.y);}assert(holdTop<tapTop-50);});
test('head collision opens question block once',()=>{restart();game.setPosition(405,384);game.player.grounded=true;game.jump();step(.3);const block=game.level.blocks.find(block=>block.x===400);assert(block.used);assert.equal(game.pickups.length,1);game.hitBlock(block);assert.equal(game.pickups.length,1);});
test('mushroom and flower transform player',()=>{restart();game.gainPower({type:'mushroom',x:100,y:380});assert.equal(game.player.power,1);assert.equal(game.player.h,52);assert.equal(game.player.y+game.player.h,416);game.gainPower({type:'flower',x:100,y:380});assert.equal(game.player.power,2);});
test('fireballs require flower and obey cooldown',()=>{restart();game.fireball();assert.equal(game.projectiles.length,0);game.gainPower({type:'flower',x:100,y:380});game.fireball();game.fireball();assert.equal(game.projectiles.length,1);step(.3);game.fireball();assert.equal(game.projectiles.length,2);});
test('small player cannot break bricks, super player can',()=>{restart();const block=game.level.blocks.find(block=>block.type==='brick');game.hitBlock(block);assert(!block.dead);step(.2);game.gainPower({type:'mushroom',x:100,y:380});game.hitBlock(block);assert(block.dead);});
test('100 coins grant extra life',()=>{restart();for(let index=0;index<100;index++)game.collectCoin(100,300);assert.equal(game.stats.lives,4);assert.equal(game.stats.coins,100);assert.equal(game.stats.score,10000);});
test('stomping a goomba bounces and defeats it',()=>{restart();const enemy=game.level.enemies.find(enemy=>enemy.type==='goomba');game.setPosition(enemy.x,enemy.y-34);game.player.vy=250;step(.025);assert(enemy.dead);assert(game.player.vy<0);});
test('turtle becomes a shell then can be kicked',()=>{restart();const enemy=game.level.enemies.find(enemy=>enemy.type==='turtle');game.setPosition(enemy.x,enemy.y-34);game.player.vy=250;step(.025);assert.equal(enemy.type,'shell');assert(enemy.vx===0);game.setPosition(enemy.x-25,enemy.y-10);step(.02);assert(Math.abs(enemy.vx)>300);});
test('damage removes power before costing a life',()=>{restart();game.gainPower({type:'flower',x:100,y:380});game.hurtPlayer();assert.equal(game.player.power,0);assert.equal(game.stats.lives,3);game.hurtPlayer();assert.equal(game.stats.lives,3);step(2.6);game.hurtPlayer();assert.equal(game.stats.state,'dying');assert.equal(game.stats.lives,2);step(1.4);assert.equal(game.stats.state,'playing');});
test('star protects against enemies but not falls',()=>{restart();game.gainPower({type:'star',x:100,y:380});game.hurtPlayer();assert.equal(game.stats.lives,3);game.hurtPlayer(true);assert.equal(game.stats.lives,2);});
test('checkpoint restores a safe position',()=>{restart();game.setPosition(2490,384);step(.02);assert.equal(game.stats.checkpoint,2480);game.hurtPlayer(true);step(1.4);assert.equal(game.player.x,2480);assert.equal(game.stats.state,'playing');});
test('pause freezes gameplay and clears held inputs',()=>{restart();game.controls.right=true;game.showPause();const before=game.stats.timeLeft;step(2);assert.equal(game.stats.timeLeft,before);assert.equal(game.controls.right,false);game.resumeGame();step(.1);assert(game.stats.timeLeft<before);});
test('death exhaustion shows retry screen',()=>{restart();for(let index=0;index<3;index++){game.hurtPlayer(true);step(1.4);}assert.equal(game.stats.state,'gameover');assert.equal(game.stats.lives,0);});
test('finishing a world saves stars and unlocks the next',()=>{restart();game.setPosition(game.level.flag,384);step(.02);assert.equal(game.stats.state,'won');assert(game.save.unlocked>=2);assert(game.save.stars[0]>=1);assert(storage.get('mario-adventure-v1'));});
test('boss prevents premature finish and takes eight fire hits',()=>{restart(3);game.setPosition(game.level.flag,384);step(.02);assert.equal(game.stats.state,'playing');for(let hit=0;hit<8;hit++){game.level.boss.invuln=0;game.damageBoss(5);}assert(game.level.boss.dead);step(.02);assert.equal(game.stats.state,'won');assert.equal(game.save.unlocked,4);});
test('all worlds render without throwing',()=>{for(let index=0;index<4;index++){restart(index);game.render();}game.showTitle();game.render();});
test('keyboard supports alternate keys and releases independently',()=>{restart();game.pressed.add('KeyD');game.pressed.add('ArrowRight');game.syncInput();assert(game.controls.right);game.pressed.delete('KeyD');game.syncInput();assert(game.controls.right);game.pressed.delete('ArrowRight');game.syncInput();assert(!game.controls.right);});
test('every pipe is jumpable and gaps are within running range',()=>{for(let index=0;index<4;index++){const level=game.buildLevel(index);for(const pipe of level.pipes)assert(pipe.h<=160);for(let groundIndex=1;groundIndex<level.grounds.length;groundIndex++){const previous=level.grounds[groundIndex-1];assert(level.grounds[groundIndex].x-previous.x-previous.w<=220);}}});
test('all four worlds can be traversed by running and jumping',()=>{
 for(let worldIndex=0;worldIndex<4;worldIndex++){
  restart(worldIndex);
  game.setInvulnerable();
  if(game.level.boss)game.level.boss.dead=true;
  let jumpTarget=null;
  for(let frame=0;frame<120*90&&game.stats.state==='playing';frame++){
   game.controls.right=true;
   game.controls.run=true;
   const hero=game.player;
   const front=hero.x+hero.w;
   if(hero.grounded){
    game.controls.jump=false;
    jumpTarget=null;
    const pipeAhead=game.level.pipes.find(pipe=>pipe.x-front>-5&&pipe.x-front<85&&pipe.y<hero.y+hero.h-5);
    const ground=game.level.grounds.find(ground=>hero.x+hero.w/2>=ground.x&&hero.x+hero.w/2<=ground.x+ground.w);
    const gapAhead=ground&&ground.x+ground.w<game.level.width&&ground.x+ground.w-front<80;
    const lowCeiling=game.level.blocks.some(block=>!block.dead&&block.x+block.w>hero.x&&block.x<front+25&&block.y<hero.y&&block.y+block.h>hero.y-120);
    const pipeEdge=game.level.pipes.some(pipe=>Math.abs(hero.y+hero.h-pipe.y)<1&&front>pipe.x+pipe.w-25&&front<pipe.x+pipe.w+28&&game.level.grounds.some(ground=>ground.x+ground.w>=pipe.x&&ground.x+ground.w-pipe.x-pipe.w<180));
    if(pipeAhead||(gapAhead&&!lowCeiling)||!ground||pipeEdge||(hero.vx===0&&hero.x>150)){game.jump();if(pipeAhead)jumpTarget=pipeAhead;}
   }
   if(jumpTarget&&hero.y+hero.h<jumpTarget.y-4)game.controls.jump=false;
   game.update(1/120);
  }
  assert.equal(game.stats.state,'won',`World ${worldIndex+1} at x=${game.player.x.toFixed(1)}, y=${game.player.y.toFixed(1)}`);
 }
});
console.log(`\n${passed} tests passed.`);
