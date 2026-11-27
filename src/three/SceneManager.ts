import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type {
  ExceedPoint,
  InspectionBatch,
  InspectionSample,
  LineProfile,
  Pole,
} from '../types';
import { Centerline, buildCenterline } from '../lib/geometry';
import { designContactHeight, designMessengerHeight, designStagger, isInTunnel } from '../lib/catenary';

const DETAIL_HALF = 600; // 高细节窗口半宽 m
const DETAIL_STEP = 0.5; // 窗口内采样步长 m
const COARSE_STEP = 10; // 全局粗模步长 m

export type CameraMode = 'orbit' | 'follow' | 'top';

export interface HudState {
  mileage: number;
  height: number;
  stagger: number;
  designHeight: number;
  contact: [number, number, number];
  inTunnel: boolean;
  playing: boolean;
}

export class SceneManager {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private controls: OrbitControls;
  private raf = 0;
  private container: HTMLElement;

  private centerline!: Centerline;
  private profile!: LineProfile;
  private direction: 'up' | 'down' = 'up';
  private poles: Pole[] = [];
  private samples: InspectionSample[] = [];
  private batch: InspectionBatch | null = null;
  private exceeds: ExceedPoint[] = [];

  private vScale = 8;
  private sScale = 6;

  // 动态对象
  private detailWire?: THREE.Line;
  private detailMessenger?: THREE.Line;
  private coarseWire?: THREE.Line;
  private pantograph!: THREE.Group;
  private contactDot!: THREE.Mesh;
  private exceedMarkers?: THREE.Group;
  private lastDetailCenter = -1;
  private clock = new THREE.Clock();
  private playing = false;
  private speed = 15; // m/s
  private mileage = 0;
  private onHud?: (h: HudState) => void;
  private cameraMode: CameraMode = 'orbit';
  private sampleIndex = 0;

  constructor(container: HTMLElement) {
    this.container = container;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    this.renderer.setClearColor(0x0b1220, 1);
    container.appendChild(this.renderer.domElement);
    this.renderer.domElement.id = 'three-canvas';

    this.scene.fog = new THREE.Fog(0x0b1220, 300, 2200);
    this.camera = new THREE.PerspectiveCamera(55, 1, 0.1, 12000);
    this.camera.position.set(30, 24, 60);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.maxPolarAngle = Math.PI * 0.495;

    const hemi = new THREE.HemisphereLight(0xbcd6ff, 0x1a2336, 0.95);
    const dir = new THREE.DirectionalLight(0xffffff, 1.1);
    dir.position.set(120, 220, 90);
    this.scene.add(hemi, dir);
    const grid = new THREE.GridHelper(400, 40, 0x274060, 0x1a2740);
    grid.position.y = -0.05;
    this.scene.add(grid);

    this.buildPantograph();
    window.addEventListener('resize', this.handleResize);
    this.animate();
  }

  onHudUpdate(cb: (h: HudState) => void) {
    this.onHud = cb;
  }

  private handleResize = () => {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    if (w === 0) return;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  };

  /** 装载线路（静态基础设施） */
  loadLine(profile: LineProfile, direction: 'up' | 'down') {
    this.profile = profile;
    this.direction = direction;
    this.poles = profile.poles.filter((p) => p.direction === direction);
    const curves = profile.curves.filter((c) => c.direction === direction);
    this.centerline = new Centerline(buildCenterline(curves, profile.totalLength));
    this.clearDynamic();
    this.buildInfrastructure();
    this.mileage = 0;
    this.sampleIndex = 0;
    this.updatePantograph();
  }

  setExaggeration(vScale: number, sScale: number) {
    this.vScale = vScale;
    this.sScale = sScale;
    if (this.samples.length) {
      this.buildCoarseWire();
      this.lastDetailCenter = -1;
      this.buildDetailWindow(this.mileage);
      this.buildExceedMarkers();
      this.updatePantograph();
    }
  }

  /** 装载检测批次（实测导线重建） */
  setBatch(samples: InspectionSample[], batch: InspectionBatch, exceeds: ExceedPoint[]) {
    this.samples = samples;
    this.batch = batch;
    this.exceeds = exceeds.filter((e) => e.direction === this.direction);
    this.mileage = 0;
    this.sampleIndex = 0;
    this.buildCoarseWire();
    this.buildExceedMarkers();
    this.lastDetailCenter = -1;
    this.buildDetailWindow(0);
    this.updatePantograph();
  }

  setCameraMode(mode: CameraMode) {
    this.cameraMode = mode;
    if (mode === 'top') {
      this.controls.enabled = false;
      this.camera.position.set(0, 600, 0.01);
      this.camera.up.set(0, 0, -1);
      this.camera.lookAt(0, 0, 0);
    } else {
      this.camera.up.set(0, 1, 0);
      this.controls.enabled = mode === 'orbit';
    }
  }

  play() {
    this.playing = true;
    this.clock.getDelta();
  }
  pause() {
    this.playing = false;
  }
  get isPlaying() {
    return this.playing;
  }
  setSpeed(v: number) {
    this.speed = v;
  }

  seek(mileage: number) {
    this.mileage = Math.max(0, Math.min(this.profile.totalLength, mileage));
    // 二分采样索引
    let lo = 0;
    let hi = this.samples.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.samples[mid].mileage < this.mileage) lo = mid + 1;
      else hi = mid;
    }
    this.sampleIndex = lo;
    this.buildDetailWindow(this.mileage);
    this.updatePantograph();
  }

  get currentMileage() {
    return this.mileage;
  }

  focusExceed(mileage: number) {
    this.pause();
    this.seek(mileage);
    this.setCameraMode('follow');
    const fr = this.centerline.frameAt(mileage);
    this.camera.position.set(fr.x + 18, 16, fr.z - 26);
    this.controls.target.set(fr.x, 6, fr.z);
    this.controls.update();
  }

  // ---------- 静态基础设施 ----------
  private infraGroup = new THREE.Group();

  private buildInfrastructure() {
    this.scene.remove(this.infraGroup);
    this.infraGroup = new THREE.Group();
    const cl = this.centerline;

    // 两条钢轨
    const gauge = 1.435;
    for (const side of [-1, 1]) {
      const pts: THREE.Vector3[] = [];
      for (let m = 0; m <= this.profile.totalLength; m += COARSE_STEP) {
        const fr = cl.frameAt(m);
        pts.push(new THREE.Vector3(fr.x + fr.nx * side * gauge * 0.5, 0.05, fr.z + fr.nz * side * gauge * 0.5));
      }
      const line = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(pts),
        new THREE.LineBasicMaterial({ color: 0x8aa0bd }),
      );
      this.infraGroup.add(line);
    }

    // 隧道（半透明外壳 + 顶壁）
    for (const t of this.profile.tunnels) {
      const len = t.endMileage - t.startMileage;
      const mid = cl.frameAt((t.startMileage + t.endMileage) / 2);
      const geo = new THREE.BoxGeometry(14, 9, len);
      const mat = new THREE.MeshBasicMaterial({
        color: 0x243b5e,
        transparent: true,
        opacity: 0.12,
        depthWrite: false,
      });
      const box = new THREE.Mesh(geo, mat);
      box.position.set(mid.x, 4.5, mid.z);
      box.rotation.y = -mid.theta;
      this.infraGroup.add(box);
      // 隧道口门架
      for (const m of [t.startMileage, t.endMileage]) {
        const f = cl.frameAt(m);
        const portal = new THREE.Mesh(
          new THREE.TorusGeometry(7, 0.18, 8, 24, Math.PI),
          new THREE.MeshBasicMaterial({ color: 0x4f9cf9 }),
        );
        portal.position.set(f.x, 0.2, f.z);
        portal.rotation.y = -f.theta;
        this.infraGroup.add(portal);
      }
    }

    // 支柱（InstancedMesh）+ 定位器
    const mastGeo = new THREE.CylinderGeometry(0.18, 0.22, 9, 7);
    const mastMat = new THREE.MeshStandardMaterial({ color: 0x5b7396, roughness: 0.7 });
    const masts = new THREE.InstancedMesh(mastGeo, mastMat, this.poles.length);
    const armGeo = new THREE.BoxGeometry(3.4, 0.16, 0.16);
    const arms = new THREE.InstancedMesh(armGeo, mastMat, this.poles.length);
    const dummy = new THREE.Object3D();
    let i = 0;
    for (const p of this.poles) {
      const fr = cl.frameAt(p.mileage);
      const side = 3.2;
      dummy.position.set(fr.x + fr.nx * side, 4.5, fr.z + fr.nz * side);
      dummy.rotation.set(0, -fr.theta, 0);
      dummy.updateMatrix();
      masts.setMatrixAt(i, dummy.matrix);

      // 定位器横臂伸向接触线
      const h = p.designHeight / 1000;
      dummy.position.set(fr.x + fr.nx * (side - 1.5), h + 0.25, fr.z + fr.nz * (side - 1.5));
      dummy.rotation.set(0, -fr.theta, 0);
      dummy.updateMatrix();
      arms.setMatrixAt(i, dummy.matrix);
      i++;
    }
    masts.instanceMatrix.needsUpdate = true;
    arms.instanceMatrix.needsUpdate = true;
    this.infraGroup.add(masts, arms);

    // 里程标（每 1km）
    for (let km = 0; km <= this.profile.totalLength; km += 1000) {
      const fr = cl.frameAt(km);
      const sprite = this.makeTextSprite(`K${km / 1000}`, '#7cb8fb');
      sprite.position.set(fr.x + fr.nx * 5, 2.2, fr.z + fr.nz * 5);
      this.infraGroup.add(sprite);
    }
    this.scene.add(this.infraGroup);
  }

  private makeTextSprite(text: string, color: string): THREE.Sprite {
    const c = document.createElement('canvas');
    c.width = 160;
    c.height = 64;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = 'rgba(15,22,38,0.75)';
    ctx.fillRect(0, 0, 160, 64);
    ctx.font = 'bold 30px Consolas';
    ctx.fillStyle = color;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, 80, 34);
    const tex = new THREE.CanvasTexture(c);
    const mat = new THREE.SpriteMaterial({ map: tex, depthTest: false });
    const sp = new THREE.Sprite(mat);
    sp.scale.set(6, 2.4, 1);
    return sp;
  }

  // ---------- 实测导线 ----------
  private clearDynamic() {
    for (const obj of [this.coarseWire, this.detailWire, this.detailMessenger, this.exceedMarkers]) {
      if (obj) {
        this.scene.remove(obj);
        disposeObject(obj);
      }
    }
    this.coarseWire = this.detailWire = this.detailMessenger = undefined;
    this.exceedMarkers = undefined;
  }

  private sampleAt(mileage: number): InspectionSample | null {
    if (!this.samples.length) return null;
    let lo = 0;
    let hi = this.samples.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.samples[mid].mileage < mileage) lo = mid + 1;
      else hi = mid;
    }
    return this.samples[lo] ?? null;
  }

  /** 全局粗模：实测接触线按 10m 抽稀，给整体走向 */
  private buildCoarseWire() {
    if (this.coarseWire) {
      this.scene.remove(this.coarseWire);
      disposeObject(this.coarseWire);
    }
    const pts: THREE.Vector3[] = [];
    for (let m = 0; m <= this.profile.totalLength; m += COARSE_STEP) {
      const s = this.sampleAt(m);
      if (!s) continue;
      const [x, y, z] = this.centerline.world(s.mileage, s.stagger, s.contactHeight, this.vScale, this.sScale);
      pts.push(new THREE.Vector3(x, y, z));
    }
    this.coarseWire = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(pts),
      new THREE.LineBasicMaterial({ color: 0x3b6ea5, transparent: true, opacity: 0.55 }),
    );
    this.scene.add(this.coarseWire);
  }

  /** 高细节窗口：实测接触线 + 承力索，毫米偏差放大可见 */
  private buildDetailWindow(centerM: number) {
    if (Math.abs(centerM - this.lastDetailCenter) < 50) return;
    this.lastDetailCenter = centerM;
    for (const old of [this.detailWire, this.detailMessenger]) {
      if (old) {
        this.scene.remove(old);
        disposeObject(old);
      }
    }
    const from = Math.max(0, centerM - DETAIL_HALF);
    const to = Math.min(this.profile.totalLength, centerM + DETAIL_HALF);
    const contactPts: THREE.Vector3[] = [];
    const messengerPts: THREE.Vector3[] = [];
    for (let m = from; m <= to; m += DETAIL_STEP) {
      const s = this.sampleAt(m);
      if (!s) continue;
      const [cx, cy, cz] = this.centerline.world(s.mileage, s.stagger, s.contactHeight, this.vScale, this.sScale);
      contactPts.push(new THREE.Vector3(cx, cy, cz));
      // 承力索：用设计模型（检测车通常只测接触线）
      const inT = isInTunnel(this.profile, m);
      const mh = designMessengerHeight(this.profile, m, inT, this.direction);
      const [mx, my, mz] = this.centerline.world(m, designStagger(this.profile, m, this.direction), mh, this.vScale, this.sScale);
      messengerPts.push(new THREE.Vector3(mx, my, mz));
    }
    this.detailWire = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(contactPts),
      new THREE.LineBasicMaterial({ color: 0xf59e0b, linewidth: 2 }),
    );
    this.detailMessenger = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(messengerPts),
      new THREE.LineBasicMaterial({ color: 0x475569 }),
    );
    this.scene.add(this.detailMessenger, this.detailWire);

    // 窗口内吊弦
    this.buildDroppers(from, to);
  }

  private dropperGroup = new THREE.Group();
  private buildDroppers(from: number, to: number) {
    this.scene.remove(this.dropperGroup);
    disposeObject(this.dropperGroup);
    this.dropperGroup = new THREE.Group();
    const mat = new THREE.LineBasicMaterial({ color: 0x64748b });
    for (const d of this.profile.droppers) {
      if (d.mileage < from || d.mileage > to) continue;
      const inT = isInTunnel(this.profile, d.mileage);
      const s = this.sampleAt(d.mileage);
      const hContact = s ? s.contactHeight : designContactHeight(this.profile, d.mileage, inT, this.direction);
      const stagger = s ? s.stagger : designStagger(this.profile, d.mileage, this.direction);
      const [cx, cy, cz] = this.centerline.world(d.mileage, stagger, hContact, this.vScale, this.sScale);
      const mh = designMessengerHeight(this.profile, d.mileage, inT, this.direction);
      const [mx, my, mz] = this.centerline.world(d.mileage, designStagger(this.profile, d.mileage, this.direction), mh, this.vScale, this.sScale);
      const geo = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(cx, cy, cz),
        new THREE.Vector3(mx, my, mz),
      ]);
      this.dropperGroup.add(new THREE.Line(geo, mat));
    }
    this.scene.add(this.dropperGroup);
  }

  private buildExceedMarkers() {
    if (this.exceedMarkers) {
      this.scene.remove(this.exceedMarkers);
      disposeObject(this.exceedMarkers);
    }
    this.exceedMarkers = new THREE.Group();
    const geo = new THREE.SphereGeometry(1.1, 12, 12);
    for (const e of this.exceeds) {
      const s = this.sampleAt(e.mileage);
      const h = s ? s.contactHeight : e.value;
      const st = s ? s.stagger : 0;
      const [x, y, z] = this.centerline.world(e.mileage, st, h, this.vScale, this.sScale);
      const mat = new THREE.MeshBasicMaterial({ color: e.level === 2 ? 0xef4444 : 0xf59e0b });
      const dot = new THREE.Mesh(geo, mat);
      dot.position.set(x, y + 0.6, z);
      dot.userData = { exceed: e };
      this.exceedMarkers.add(dot);
    }
    this.scene.add(this.exceedMarkers);
  }

  // ---------- 受电弓 ----------
  private buildPantograph() {
    this.pantograph = new THREE.Group();
    const metal = new THREE.MeshStandardMaterial({ color: 0xc0392b, roughness: 0.5, metalness: 0.3 });
    const base = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.25, 1.6), metal);
    base.position.y = 0.45;
    const arm1 = new THREE.Mesh(new THREE.BoxGeometry(0.12, 3.4, 0.12), metal);
    arm1.position.set(-0.5, 2.2, 0);
    arm1.rotation.z = 0.32;
    const arm2 = arm1.clone();
    arm2.position.x = 0.5;
    arm2.rotation.z = -0.32;
    const strip = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.12, 0.28), new THREE.MeshStandardMaterial({ color: 0xe2e8f0 }));
    strip.position.y = 4.0;
    this.pantograph.add(base, arm1, arm2, strip);
    this.contactDot = new THREE.Mesh(
      new THREE.SphereGeometry(0.45, 16, 16),
      new THREE.MeshBasicMaterial({ color: 0x22d3ee }),
    );
    this.pantograph.add(this.contactDot);
    this.scene.add(this.pantograph);
  }

  private updatePantograph() {
    if (!this.centerline || !this.profile) return;
    const s = this.sampleAt(this.mileage);
    const fr = this.centerline.frameAt(this.mileage);
    const h = s ? s.contactHeight : this.profile.designHeight;
    const st = s ? s.stagger : 0;
    const [wx, wy, wz] = this.centerline.world(this.mileage, st, h, this.vScale, this.sScale);
    // 受电弓沿线路姿态放置（车体在轨道上，不做横向放大，弓头偏移按放大后的接触线位置）
    this.pantograph.position.set(fr.x, 0, fr.z);
    this.pantograph.rotation.y = -fr.theta;
    // 弓头/接触点贴合接触线
    this.contactDot.position.set(
      fr.nx * (st / 1000) * this.sScale,
      wy,
      fr.nz * (st / 1000) * this.sScale,
    );
    const inTunnel = isInTunnel(this.profile, this.mileage);
    this.onHud?.({
      mileage: this.mileage,
      height: s?.contactHeight ?? 0,
      stagger: s?.stagger ?? 0,
      designHeight: this.nearestPoleHeight(),
      contact: [wx, wy, wz],
      inTunnel,
      playing: this.playing,
    });
  }

  private nearestPoleHeight(): number {
    let best = this.poles[0];
    let bd = Infinity;
    for (const p of this.poles) {
      const d = Math.abs(p.mileage - this.mileage);
      if (d < bd) {
        bd = d;
        best = p;
      }
    }
    return best?.designHeight ?? this.profile.designHeight;
  }

  private animate = () => {
    this.raf = requestAnimationFrame(this.animate);
    const dt = Math.min(0.05, this.clock.getDelta());
    if (this.playing && this.profile) {
      this.mileage += this.speed * dt;
      if (this.mileage >= this.profile.totalLength) {
        this.mileage = this.profile.totalLength;
        this.pause();
      }
      // 推进采样索引
      while (this.sampleIndex < this.samples.length - 1 && this.samples[this.sampleIndex].mileage < this.mileage) {
        this.sampleIndex++;
      }
      this.buildDetailWindow(this.mileage);
      this.updatePantograph();
      if (this.cameraMode === 'follow') this.updateFollowCamera();
    }
    if (this.cameraMode === 'top' && this.profile) {
      const fr = this.centerline.frameAt(this.mileage);
      this.camera.position.set(fr.x, 500, fr.z + 0.01);
      this.camera.lookAt(fr.x, 0, fr.z);
    }
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  };

  private updateFollowCamera() {
    const fr = this.centerline.frameAt(this.mileage);
    const back = 26;
    this.camera.position.set(fr.x - fr.tx * back + fr.nx * 14, 13, fr.z - fr.tz * back + fr.nz * 14);
    this.controls.target.set(fr.x, 5.5, fr.z);
  }

  dispose() {
    cancelAnimationFrame(this.raf);
    window.removeEventListener('resize', this.handleResize);
    this.controls.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}

function disposeObject(obj: THREE.Object3D) {
  obj.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.geometry) mesh.geometry.dispose();
    const mat = mesh.material as THREE.Material | THREE.Material[] | undefined;
    if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
    else mat?.dispose();
  });
}
