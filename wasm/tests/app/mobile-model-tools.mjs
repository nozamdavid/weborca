import assert from 'node:assert/strict';
import { build } from '../../app/node_modules/esbuild/lib/main.js';
import { chromium } from '../node_modules/playwright/index.mjs';

// Compile only the live scene and its dependencies; no application build or engine.
const bundle = await build({
  stdin: { contents: `
    import { PlateScene } from './src/plate/PlateScene';
    import * as THREE from 'three';
    window.scene = new PlateScene(document.querySelector('main'), {
      points: [[0,0],[200,0],[200,200],[0,200]], width: 200, depth: 200, height: 200, center: [100,100]
    }, {
      onSelect: (id, instance) => window.scene.setSelection(id, instance),
      onTransformChange: (...args) => window.commits.push(args),
      onVolumeTransformChange: () => {}, getMesh: async () => {}, getViewerMesh: async () => {}
    });
    window.commits = [];
    window.trustedTouches = [];
    document.addEventListener('pointerdown', e => {
      if (e.pointerType === 'touch') window.trustedTouches.push(e.isTrusted);
    }, true);
    const s = window.scene;
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(40,40,40), s.defaultMaterial);
    mesh.position.set(100,100,20); mesh.userData = {objectId: 1, instanceId: 1};
    s.objectsGroup.add(mesh); s.objectMeshes.set('1_1', mesh);
    s.setSelection(1,1); s.setGizmoMode('translate');
    window.mesh = mesh;
    window.snapshot = () => ({position: mesh.position.toArray(), scale: mesh.scale.toArray(),
      camera: s.camera.quaternion.toArray(), target: s.orbitControls.target.toArray(),
      distance: s.camera.position.distanceTo(s.orbitControls.target), zoom: s.camera.zoom,
      commits: window.commits.length, drag: !!s.planeDrag, orbit: s.orbitControls.enabled,
      transform: s.transformControls.enabled, selected: s.selectedObjectId});
    window.modelPoint = () => {
      mesh.updateWorldMatrix(true,false); s.camera.updateMatrixWorld();
      const p = mesh.position.clone().project(s.camera), r = s.renderer.domElement.getBoundingClientRect();
      const point = {x:r.left+(p.x+1)*r.width/2, y:r.top+(1-p.y)*r.height/2};
      if (!s.hitTest(point.x, point.y) || document.elementFromPoint(point.x,point.y) !== s.renderer.domElement) throw Error('Fixture must hit unobstructed actual model');
      return point;
    };
  `, resolveDir: new URL('../../app/', import.meta.url).pathname },
  bundle: true, write: false, format: 'iife', platform: 'browser',
  define: { 'import.meta.env': '{}', 'import.meta.url': '"http://touch-fixture.local/fixture.js"' },
  loader: { '.wasm': 'empty', '.css': 'empty' }, logLevel: 'error',
});
const browser = await chromium.launch({headless: true, args: ['--enable-webgl', '--use-gl=angle', '--use-angle=swiftshader']});
try {
  const context = await browser.newContext({viewport: {width: 390, height: 700}, hasTouch: true});
  await context.route('**/*', route => route.fulfill({contentType:'text/html', body:'<style>body{margin:0}main{width:390px;height:700px}</style><main></main>'}));
  const page = await context.newPage();
  page.on('pageerror', error => console.error(error.message));
  await page.goto('http://touch-fixture.local');
  await page.addScriptTag({content:bundle.outputFiles[0].text});
  await page.waitForTimeout(400);
  const cdp = await context.newCDPSession(page);
  const touch = async (type, points) => {
    await cdp.send('Input.dispatchTouchEvent', {type, touchPoints: points.map(p => ({...p, radiusX:1, radiusY:1, force:1}))});
    await page.waitForTimeout(40);
  };
  const snapshot = () => page.evaluate(() => window.snapshot());
  await page.evaluate(() => window.scene.setSelection(null,null));
  const selectionPoint = {...await page.evaluate(() => window.modelPoint()),id:1};
  await touch('touchStart',[selectionPoint]);
  await touch('touchEnd',[]);
  assert.equal((await snapshot()).selected,1,'trusted touch selects actual raycast model');
  assert.equal((await snapshot()).commits,0,'selection tap adds no undo entry');
  const near = (a,b,label,tolerance=1e-7) => assert.ok(a.every((n,i) => Math.abs(n-b[i])<tolerance), label);
  const different = (a,b,label) => assert.ok(a.some((n,i) => Math.abs(n-b[i])>0.001), label);
  const sameCamera = (a,b) => {
    near(a.camera,b.camera,'model gesture preserves camera rotation',0.001);
    near(a.target,b.target,'model gesture preserves camera target',0.001);
    near([a.distance,a.zoom],[b.distance,b.zoom],'model gesture preserves camera zoom',0.001);
  };
  const ready = async mode => {
    await page.evaluate(mode => window.scene.setGizmoMode(mode),mode);
    return {...await page.evaluate(() => window.modelPoint()), id:1};
  };
  const checkModelDrag = async mode => {
    const point = await ready(mode), before = await snapshot();
    await touch('touchStart', [point]);
    await touch('touchMove', [{...point,x:point.x+20,y:point.y-20}]);
    await touch('touchEnd', []);
    const after = await snapshot();
    console.log(`model ${mode}`,JSON.stringify({before,after}));
    different(after[mode === 'scale' ? 'scale' : 'position'], before[mode === 'scale' ? 'scale' : 'position'], `one-finger ${mode} changes model`);
    near(after[mode === 'scale' ? 'position' : 'scale'],before[mode === 'scale' ? 'position' : 'scale'],`${mode} changes only intended transform`);
    sameCamera(before,after);
    assert.equal(after.commits,before.commits+1,'model gesture commits once through normal history callback');
    assert.ok(!after.drag && after.orbit && after.transform,'gesture releases control ownership');
  };
  await checkModelDrag('translate');
  await checkModelDrag('scale');
  console.log('PASS trusted touch Move/Scale changes model, preserves camera, commits once');

  // Interruptions must roll back, avoid history entries, and allow the next gesture.
  for (const mode of ['translate','scale']) for (const interruption of ['cancel','second','capture','blur']) {
    const point = await ready(mode), before = await snapshot();
    const moved = {...point,x:point.x+20,y:point.y-20};
    await touch('touchStart',[point]);
    await touch('touchMove',[moved]);
    if (interruption === 'cancel') await touch('touchCancel',[]);
    if (interruption === 'second') {
      const other = {x:point.x+70,y:point.y,id:2};
      const cameraBefore = await snapshot();
      await touch('touchStart',[moved,other]);
      sameCamera(cameraBefore,await snapshot());
      await touch('touchMove',[{...moved,x:moved.x-15},{...other,x:other.x+15}]);
      const zoomed = await snapshot();
      assert.ok(Math.abs(zoomed.distance-cameraBefore.distance)>0.01 || Math.abs(zoomed.zoom-cameraBefore.zoom)>0.001,'second finger takes over pinch');
      await touch('touchEnd',[other]);
      await touch('touchEnd',[]);
      await page.waitForTimeout(800);
    }
    if (interruption === 'capture') {
      await page.evaluate(() => {
        const s = window.scene;
        s.renderer.domElement.releasePointerCapture(s.planeDrag.pointerId);
      });
      await touch('touchMove',[{...moved,x:moved.x+1}]);
      await touch('touchEnd',[]);
    }
    if (interruption === 'blur') {
      await page.evaluate(() => window.dispatchEvent(new Event('blur')));
      await touch('touchEnd',[]);
    }
    const after = await snapshot();
    near(after.position,before.position,`${interruption} rolls back position`);
    near(after.scale,before.scale,`${interruption} rolls back scale`);
    assert.equal(after.commits,before.commits,`${interruption} adds no undo entry`);
    assert.ok(!after.drag && after.orbit && after.transform,`${interruption} clears ownership`);
    // Let OrbitControls' existing damping settle before measuring the next model gesture.
    await page.waitForTimeout(800);
    await checkModelDrag(mode);
    console.log(`PASS ${mode} ${interruption} rollback and next drag`);
  }
  // Find empty canvas with the real model raycast after the preceding transforms.
  const empty = await page.evaluate(() => {
    const s = window.scene;
    for (let y=100;y<600;y+=40) for(let x=30;x<350;x+=40) if(s.plateAt(x,y)===0 && !s.hitTest(x,y)) return {x,y,id:1};
    throw Error('No empty canvas point');
  });
  let before = await snapshot();
  await touch('touchStart',[empty]);
  await touch('touchMove',[{...empty,x:empty.x+25,y:empty.y+10}]);
  await touch('touchEnd',[]);
  await page.waitForTimeout(800);
  let after = await snapshot();
  different(after.camera,before.camera,'empty canvas still orbits');
  near(after.position,before.position,'empty canvas preserves model');
  near(after.scale,before.scale,'empty canvas preserves scale');
  const a={x:100,y:500,id:1},b={x:200,y:500,id:2};
  before=await snapshot();
  await touch('touchStart',[a,b]);
  await touch('touchMove',[{...a,x:80},{...b,x:220}]);
  await page.waitForTimeout(800);
  after=await snapshot();
  assert.ok(Math.abs(after.distance-before.distance)>0.01 || Math.abs(after.zoom-before.zoom)>0.001,'two-finger pinch zooms');
  before=after;
  await touch('touchMove',[{...a,x:90,y:515},{...b,x:230,y:515}]);
  await page.waitForTimeout(800);
  different((await snapshot()).target,before.target,'two-finger translation pans');
  await touch('touchEnd',[]);
  await page.waitForTimeout(800);
  before=await snapshot();
  await page.mouse.move(empty.x,empty.y);
  await page.mouse.down();
  await page.mouse.move(empty.x+25,empty.y+10,{steps:4});
  await page.mouse.up();
  await page.waitForTimeout(800);
  different((await snapshot()).camera,before.camera,'desktop mouse still orbits');
  assert.ok(await page.evaluate(() => window.trustedTouches.length>0 && window.trustedTouches.every(Boolean)),'actual trusted CDP touch events');
  console.log('PASS empty-bed orbit, two-finger pinch/pan, desktop mouse, trusted input');
  await page.evaluate(() => {
    const s=window.scene;
    window.mesh.position.set(100,100,20); window.mesh.scale.setScalar(1);
    s.orbitControls.target.set(100,100,0); s.camera.position.set(100,-200,240);
    s.orbitControls.update(); s.setGizmoMode(null);
  });
  await page.waitForTimeout(800);
  const mousePoint=await page.evaluate(() => window.modelPoint());
  before=await snapshot();
  await page.mouse.move(mousePoint.x,mousePoint.y);
  await page.mouse.down();
  await page.mouse.move(mousePoint.x+15,mousePoint.y-10,{steps:4});
  await page.mouse.up();
  after=await snapshot();
  different(after.position,before.position,'desktop mouse still moves model');
  assert.equal(after.commits,before.commits+1,'desktop mouse commits once');
  console.log('PASS desktop mouse model movement');
  await page.evaluate(() => {
    const s=window.scene;
    window.mesh.position.set(100,100,20);window.mesh.scale.setScalar(1);
    s.setGizmoMode('scale');s.setCameraType('orthographic');
    s.orbitControls.enableDamping=false;s.setCameraView(3);
  });
  await page.waitForTimeout(800);
  const frontPoint={...await page.evaluate(()=>window.modelPoint()),id:1};
  before=await snapshot();
  await touch('touchStart',[frontPoint]);
  await touch('touchMove',[{...frontPoint,y:frontPoint.y+30}]);
  await touch('touchEnd',[]);
  after=await snapshot();
  assert.ok(after.scale[0]<before.scale[0],'downward front-view Scale shrinks the model');
  sameCamera(before,after);
  assert.equal(after.commits,before.commits+1,'front-view scaling commits once');
  console.log('PASS front-view downward Scale');
  await page.evaluate(() => {
    const s=window.scene;
    window.mesh.position.set(100,100,20);window.mesh.scale.setScalar(1);
    s.orbitControls.target.set(100,100,0);s.camera.position.set(100,-200,240);
    s.orbitControls.update();s.setGizmoMode('translate');
  });
  await page.waitForTimeout(800);
  const hybridPoint={...await page.evaluate(()=>window.modelPoint()),id:1};
  before=await snapshot();
  await touch('touchStart',[hybridPoint]);
  const hybridMoved={...hybridPoint,x:hybridPoint.x+12,y:hybridPoint.y-10};
  await touch('touchMove',[hybridMoved]);
  const secondPoint=await page.evaluate(()=>window.modelPoint());
  await page.mouse.move(secondPoint.x,secondPoint.y);await page.mouse.down();
  await page.mouse.move(secondPoint.x+10,secondPoint.y-10,{steps:3});await page.mouse.up();
  await touch('touchEnd',[]);
  after=await snapshot();
  assert.ok(!after.drag && after.orbit && after.transform,'overlapping mouse and touch restores controls');
  assert.equal(after.commits,before.commits+1,'overlapping mouse does not replace or commit the touch-owned drag');
  sameCamera(before,after);
  console.log('PASS overlapping mouse/touch ownership');
  const mouseFirstPoint=await page.evaluate(()=>window.modelPoint());
  before=await snapshot();
  await page.mouse.move(mouseFirstPoint.x,mouseFirstPoint.y);await page.mouse.down();
  await page.mouse.move(mouseFirstPoint.x+10,mouseFirstPoint.y-10,{steps:3});
  const touchSecond={...await page.evaluate(()=>window.modelPoint()),id:1};
  await touch('touchStart',[touchSecond]);
  await page.mouse.up();await touch('touchEnd',[]);
  after=await snapshot();
  assert.ok(!after.drag && after.orbit && after.transform,'mouse-first overlap restores controls');
  assert.equal(after.commits,before.commits+1,'mouse-first overlap commits only its owner');
  console.log('PASS mouse-first overlapping ownership');
} finally { await browser.close(); }
