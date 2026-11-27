// ============================================================
// 三维核查场景：实测导高/拉出值重建接触线与承力索、吊弦、定位器、
// 支柱、隧道、受电弓/检测车、超限标。坐标 x=里程方向，y=高度，z=横向。
// ============================================================
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type {
  CurveInfo,
  Defect,
  LineInfo,
  Pole,
  DetectionRun,
  Settings,
  TrackId,
  TunnelInfo,
  LocatorInfo,
  DropperInfo,
} from '../core/types';
import { buildPlan, type Plan } from '../core/plan';
import { bisectLeft } from '../core/format';

interface ArchiveData {
  line: LineInfo;
  curves: CurveInfo[];
  tunnels: TunnelInfo[];
  poles: Pole[];
  locators: LocatorInfo[];
  droppers: DropperInfo[];
}

interface ViewData {
  track: TrackId;
  run: DetectionRun | null;
  defects: Defect[];
}

const UP = new THREE.Vector3(0, 1, 0);

export class CatenaryScene {
  private container: HTMLElement;
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private controls: OrbitControls;
  private raf = 0;
  private ro: ResizeObserver;
  private clockLast = performance.now();

  private archive: ArchiveData | null = null;
  private plan: Plan | null = null;
  private view: ViewData = { track: 'up', run: null, defects: [] };
  private settings: Settings | null = null;

  private staticGroup = new THREE.Group();
  private dynamicGroup = new THREE.Group();
  private markerGroup = new THREE.Group();
  private pantoGroup = new THREE.Group();
  private carGroup = new THREE.Group();

  private markerMeshes: THREE.Mesh[] = [];
  private contactSphere!: THREE.Mesh;
  private pantoHead!: THREE.Mesh;
  private bars: THREE.Mesh[] = [];

  private mileage = 0;
  private playing = false;
  private speedMul = 4;
  private readonly baseSpeed = 16; // 1x 下 m/s（约 58km/h 回放节奏）
  private follow = true;
  private mileageCbAcc = 0;

  private raycaster = new THREE.Raycaster();
  private pointer = new THREE.Vector2();
  private downXY = { x: 0, y: 0 };

  public onDefectClick?: (id: string) => void;
  public onMileage?: (m: number) => void;
  public onPlayEnd?: () => void;

  constructor(container: HTMLElement) {
    this.container = container;
    const w = container.clientWidth || 800;
    const h = container.clientHeight || 600;

    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(w, h);
    this.renderer.shadowMap.enabled = false;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#0b1626');
    this.scene.fog = new THREE.Fog('#0b1626', 220, 1500);

    this.camera = new THREE.PerspectiveCamera(58, w / h, 0.3, 6000);
    this.camera.position.set(-14, 9, 18);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.maxDistance = 900;
    this.controls.minDistance = 1.5;
    this.controls.maxPolarAngle = Math.PI * 0.495;
    this.controls.target.set(0, 5.5, 0);

    // 灯光
    const hemi = new THREE.HemisphereLight(0xcfe6ff, 0x3a4658, 1.05);
    this.scene.add(hemi);
    const sun = new THREE.DirectionalLight(0xffffff, 1.5);
    sun.position.set(-120, 220, 80);
    this.scene.add(sun);
    const fill = new THREE.DirectionalLight(0x88bbff, 0.35);
    fill.position.set(120, 80, -160);
    this.scene.add(fill);

    this.scene.add(this.staticGroup, this.dynamicGroup, this.markerGroup, this.carGroup, this.pantoGroup);

    this.buildPanto();

    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(container);

    const el = this.renderer.domElement;
    el.addEventListener('pointerdown', this.handlePointerDown);
    el.addEventListener('pointerup', this.handlePointerUp);
    el.addEventListener('pointermove', this.handlePointerMove);

    this.animate();
    (window as unknown as { __cs?: CatenaryScene }).__cs = this;
  }

  // ---------------- 档案 / 视图 ----------------

  setArchive(archive: ArchiveData, settings: Settings) {
    // 关键：Dexie toArray 按字符串主键返回会得到 S1,S10,S100… 的乱序，
    // 所有按里程连线的逻辑都依赖升序，这里统一排序一次。
    const sortedPoles = [...archive.poles].sort((a, b) =>
      a.track === b.track ? a.mileage - b.mileage : a.track < b.track ? -1 : 1,
    );
    this.archive = { ...archive, poles: sortedPoles };
    this.settings = settings;
    this.plan = buildPlan(archive.curves, archive.line.totalLength);
    this.clearGroup(this.staticGroup);
    this.buildGround();
    this.buildTracks();
    this.buildPoles();
    this.buildTunnels();
    this.rebuildDynamic();
    this.seek(0, true);
  }

  setSettings(s: Settings) {
    const prev = this.settings;
    this.settings = s;
    this.controls.enabled = true;
    if (prev && (prev.verticalExaggeration !== s.verticalExaggeration || prev.lateralExaggeration !== s.lateralExaggeration)) {
      this.rebuildDynamic();
    } else {
      this.setLayerVisibility();
    }
  }

  setView(v: ViewData) {
    this.view = v;
    this.rebuildDynamic();
  }

  setFollow(f: boolean) {
    this.follow = f;
  }

  // ---------------- 坐标换算 ----------------

  private trackOffset(track: TrackId): number {
    const sp = this.archive?.line.trackSpacing ?? 5;
    return track === 'up' ? -sp / 2 : sp / 2;
  }

  /** 轨道中心世界坐标+方向框架 */
  private trackFrame(mileage: number, track: TrackId = this.view.track) {
    const p = this.plan!.at(mileage);
    const off = this.trackOffset(track);
    return {
      x: p.x + p.nx * off,
      z: p.z + p.nz * off,
      tx: p.tx,
      tz: p.tz,
      nx: p.nx,
      nz: p.nz,
      theta: p.theta,
    };
  }

  private contactTransform() {
    const vx = this.settings?.verticalExaggeration ?? 1;
    const lx = this.settings?.lateralExaggeration ?? 1;
    const dh = this.archive?.line.designHeight ?? 6000;
    return { vx, lx, dh };
  }

  /** 某里程处实测接触线的渲染坐标（含放大） */
  contactWorld(mileage: number, target = new THREE.Vector3()): THREE.Vector3 {
    const f = this.trackFrame(mileage);
    let h = this.archive?.line.designHeight ?? 6000;
    let pull = 0;
    const run = this.view.run;
    if (run && run.pointCount > 1) {
      const s = sampleRunAt(run, mileage);
      h = s.height;
      pull = s.pull;
    }
    const { vx, lx, dh } = this.contactTransform();
    const y = dh / 1000 + ((h - dh) / 1000) * vx;
    const lat = (pull / 1000) * lx;
    target.set(f.x + f.nx * lat, y, f.z + f.nz * lat);
    return target;
  }

  // ---------------- 静态场景 ----------------

  private buildGround() {
    if (!this.plan || !this.archive) return;
    const L = this.archive.line.totalLength;

    // 大地带
    const terrain = this.buildRibbon(52, 0, 6, new THREE.MeshLambertMaterial({ color: '#2c3e57' }), L);
    terrain.position.y = -0.06;
    this.staticGroup.add(terrain);

    // 道床
    const ballast = this.buildRibbon(11.5, 0, 4, new THREE.MeshLambertMaterial({ color: '#5b6675' }), L);
    ballast.position.y = 0;
    this.staticGroup.add(ballast);
  }

  /** 沿中线的带状平面 */
  private buildRibbon(width: number, y: number, stepM: number, mat: THREE.Material, L: number): THREE.Mesh {
    const n = Math.floor(L / stepM) + 1;
    const pos = new Float32Array(n * 2 * 3);
    const idx: number[] = [];
    for (let i = 0; i < n; i++) {
      const m = i * stepM;
      const p = this.plan!.at(m);
      pos[i * 6 + 0] = p.x + p.nx * width / 2;
      pos[i * 6 + 1] = y;
      pos[i * 6 + 2] = p.z + p.nz * width / 2;
      pos[i * 6 + 3] = p.x - p.nx * width / 2;
      pos[i * 6 + 4] = y;
      pos[i * 6 + 5] = p.z - p.nz * width / 2;
      if (i < n - 1) {
        const a = i * 2;
        idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    return new THREE.Mesh(g, mat);
  }

  private buildTracks() {
    if (!this.archive) return;
    const sleeperTex = makeSleeperTexture();
    sleeperTex.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
    for (const track of ['up', 'down'] as TrackId[]) {
      // 钢轨
      for (const gauge of [-0.7175, 0.7175]) {
        const pts: THREE.Vector3[] = [];
        const L = this.archive.line.totalLength;
        for (let m = 0; m <= L; m += 4) {
          const f = this.trackFrame(m, track);
          pts.push(new THREE.Vector3(f.x + f.nx * gauge, 0.24, f.z + f.nz * gauge));
        }
        const g = new THREE.BufferGeometry().setFromPoints(pts);
        const line = new THREE.Line(g, new THREE.LineBasicMaterial({ color: '#b6c4d8' }));
        this.staticGroup.add(line);
      }
      // 轨枕贴图带（避免数十万实例造成摩尔纹）
      const bed = this.buildTrackBed(3.1, 0.16, track, sleeperTex);
      this.staticGroup.add(bed);
    }
  }

  /** 带 UV 的轨枕带，u 方向每 4m 一个贴图周期 */
  private buildTrackBed(width: number, y: number, track: TrackId, tex: THREE.Texture): THREE.Mesh {
    const L = this.archive!.line.totalLength;
    const step = 2;
    const n = Math.floor(L / step) + 1;
    const pos = new Float32Array(n * 2 * 3);
    const uv = new Float32Array(n * 2 * 2);
    const idx: number[] = [];
    for (let i = 0; i < n; i++) {
      const m = i * step;
      const p = this.plan!.at(m);
      const off = this.trackOffset(track);
      const cx = p.x + p.nx * off;
      const cz = p.z + p.nz * off;
      pos[i * 6 + 0] = cx + p.nx * width / 2;
      pos[i * 6 + 1] = y;
      pos[i * 6 + 2] = cz + p.nz * width / 2;
      pos[i * 6 + 3] = cx - p.nx * width / 2;
      pos[i * 6 + 4] = y;
      pos[i * 6 + 5] = cz - p.nz * width / 2;
      uv[i * 4 + 0] = m / 4;
      uv[i * 4 + 1] = 1;
      uv[i * 4 + 2] = m / 4;
      uv[i * 4 + 3] = 0;
      if (i < n - 1) {
        const a = i * 2;
        idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    const mat = new THREE.MeshLambertMaterial({ map: tex, transparent: true, alphaTest: 0.05 });
    return new THREE.Mesh(g, mat);
  }

  private buildPoles() {
    if (!this.archive) return;
    const poles = this.archive.poles;
    // 支柱
    const poleGeo = new THREE.CylinderGeometry(0.16, 0.24, 7.6, 7);
    const poleMat = new THREE.MeshLambertMaterial({ color: '#c3ccd9' });
    const poleInst = new THREE.InstancedMesh(poleGeo, poleMat, poles.length);

    // 腕臂
    const armGeo = new THREE.BoxGeometry(0.16, 0.16, 2.6);
    const armMat = new THREE.MeshLambertMaterial({ color: '#7d8ca3' });
    const armInst = new THREE.InstancedMesh(armGeo, armMat, poles.length);

    const dummy = new THREE.Object3D();
    const armDir = new THREE.Vector3();
    const zAxis = new THREE.Vector3(0, 0, 1);

    poles.forEach((p, i) => {
      const f = this.trackFrame(p.mileage, p.track);
      const sideSign = p.side === 'left' ? 1 : -1;
      const mastLat = sideSign * 3.4;
      const mx = f.x + f.nx * mastLat;
      const mz = f.z + f.nz * mastLat;
      dummy.position.set(mx, 3.8, mz);
      dummy.rotation.set(0, 0, 0);
      dummy.updateMatrix();
      poleInst.setMatrixAt(i, dummy.matrix);

      // 腕臂从支柱顶部伸向线路上方
      const wireLat = 0; // 静态腕臂朝轨心
      const endX = f.x + f.nx * wireLat;
      const endZ = f.z + f.nz * wireLat;
      armDir.set(endX - mx, 0, endZ - mz).normalize();
      const q = new THREE.Quaternion().setFromUnitVectors(zAxis, armDir);
      dummy.position.set((mx + endX) / 2, 6.7, (mz + endZ) / 2);
      dummy.quaternion.copy(q);
      dummy.updateMatrix();
      armInst.setMatrixAt(i, dummy.matrix);
    });
    poleInst.instanceMatrix.needsUpdate = true;
    armInst.instanceMatrix.needsUpdate = true;
    this.staticGroup.add(poleInst, armInst);
  }

  private buildTunnels() {
    if (!this.archive) return;
    for (const tn of this.archive.tunnels) {
      const mesh = this.buildTunnelArch(tn.start, tn.end);
      this.staticGroup.add(mesh);
      // 入口标牌
      const label = makeTextSprite(tn.name, '#fde68a');
      const f = this.plan!.at(tn.start);
      label.position.set(f.x, 9.2, f.z);
      label.scale.set(16, 4, 1);
      label.name = 'label';
      this.staticGroup.add(label);
    }
  }

  private buildTunnelArch(start: number, end: number): THREE.Mesh {
    const W = 7.6;
    const wallH = 1.2;
    const archH = 6.4;
    const step = 8;
    const ring = 18;
    const n = Math.floor((end - start) / step) + 1;
    const positions: number[] = [];
    const indices: number[] = [];

    for (let i = 0; i < n; i++) {
      const m = start + i * step;
      const f = this.plan!.at(Math.min(m, end));
      for (let j = 0; j <= ring; j++) {
        const a = (j / ring) * Math.PI; // 0..π
        const lat = Math.cos(a) * W;
        const y = wallH + Math.sin(a) * archH;
        positions.push(f.x + f.nx * lat, y, f.z + f.nz * lat);
      }
    }
    const cols = ring + 1;
    for (let i = 0; i < n - 1; i++) {
      for (let j = 0; j < ring; j++) {
        const a = i * cols + j;
        const b = a + 1;
        const c = a + cols;
        const d = c + 1;
        indices.push(a, c, b, b, c, d);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    g.setIndex(indices);
    g.computeVertexNormals();
    const mat = new THREE.MeshStandardMaterial({
      color: '#54637a',
      roughness: 0.95,
      metalness: 0.05,
      transparent: true,
      opacity: 0.32,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    return new THREE.Mesh(g, mat);
  }

  // ---------------- 动态：导线 / 吊弦 / 定位器 / 标 ----------------

  private clearGroup(g: THREE.Group) {
    g.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.geometry) mesh.geometry.dispose();
      const mat = (mesh as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
      else if (mat) mat.dispose();
    });
    g.clear();
  }

  private rebuildDynamic() {
    if (!this.archive || !this.plan || !this.settings) return;
    this.clearGroup(this.dynamicGroup);
    this.clearGroup(this.markerGroup);
    this.markerMeshes = [];

    this.buildDesignWires();
    this.buildMeasuredWiresAndEquipment();
    this.buildDefectMarkers();
    this.setLayerVisibility();
  }

  /** 设计接触线（之字基准） */
  private buildDesignWires() {
    if (!this.archive || !this.settings) return;
    const { line, locators } = this.archive;
    for (const track of ['up', 'down'] as TrackId[]) {
      const poles = this.archive.poles.filter((p) => p.track === track);
      const locMap = new Map(locators.filter((l) => l.track === track).map((l) => [l.poleCode, l]));
      const pts: THREE.Vector3[] = [];
      const lx = this.settings.lateralExaggeration;
      for (const p of poles) {
        const f = this.trackFrame(p.mileage, track);
        const stagger = locMap.get(p.code)?.designStagger ?? 250;
        const lat = (stagger / 1000) * lx;
        pts.push(new THREE.Vector3(f.x + f.nx * lat, line.designHeight / 1000, f.z + f.nz * lat));
      }
      if (pts.length > 1) {
        const tube = buildTube(pts, 0.028, 5, new THREE.MeshBasicMaterial({ color: '#60a5fa', transparent: true, opacity: 0.55 }));
        tube.name = 'designWire';
        this.dynamicGroup.add(tube);
      }
    }
  }

  /** 实测接触线（管）+ 承力索 + 吊弦 + 定位器，按锚段分块 */
  private buildMeasuredWiresAndEquipment() {
    if (!this.archive || !this.settings || !this.view.run) {
      // 无 run 时仍给选中线别一条静态基准线已在 design 中
      return;
    }
    const run = this.view.run;
    const track = this.view.track;
    const { line, poles, droppers } = this.archive;
    const { vx, lx, dh } = this.contactTransform();

    const trackPoles = poles.filter((p) => p.track === track).sort((a, b) => a.mileage - b.mileage);
    if (trackPoles.length < 2) return;

    // 按锚段（这里用每 ~24 跨分块，或直接用 archive.anchors）
    const anchors = this.archiveAnchorsLike(track);

    for (const anc of anchors) {
      const m0 = anc.from;
      const m1 = anc.to;
      const i0 = Math.max(0, bisectLeft(run.fixedMileage, m0) - 1);
      const i1 = Math.min(run.pointCount - 1, bisectLeft(run.fixedMileage, m1) + 1);
      if (i1 - i0 < 2) continue;

      // 接触线点
      const cPts: THREE.Vector3[] = [];
      for (let i = i0; i <= i1; i++) {
        const m = run.fixedMileage[i];
        const f = this.trackFrame(m, track);
        const y = dh / 1000 + ((run.height[i] - dh) / 1000) * vx;
        const lat = (run.pull[i] / 1000) * lx;
        cPts.push(new THREE.Vector3(f.x + f.nx * lat, y, f.z + f.nz * lat));
      }
      const contactTube = buildTube(
        cPts,
        0.055,
        6,
        new THREE.MeshStandardMaterial({ color: '#fbbf24', emissive: '#7a4d00', emissiveIntensity: 0.5, roughness: 0.4, metalness: 0.6 }),
      );
      contactTube.name = 'contactWire';
      this.dynamicGroup.add(contactTube);

      // 承力索 + 吊弦（按跨）；承力索合并为该锚段一根管
      const eqPos: number[] = [];
      const msgAll: THREE.Vector3[] = [];
      const msgMat = new THREE.MeshStandardMaterial({ color: '#94a3b8', roughness: 0.5, metalness: 0.7 });
      const spanPoles = trackPoles.filter((p) => p.mileage >= m0 - 1 && p.mileage <= m1 + 1);
      for (let k = 0; k < spanPoles.length - 1; k++) {
        const pa = spanPoles[k];
        const pb = spanPoles[k + 1];
        // 端点接触线位置（在 run 中插值）
        const ca = this.contactWorld(pa.mileage);
        const cb = this.contactWorld(pb.mileage);
        const ma = ca.clone();
        ma.y += 1.35;
        const mb = cb.clone();
        mb.y += 1.35;
        const sag = 0.55 + (pb.mileage - pa.mileage) * 0.006;

        const SEG = 12;
        for (let s = 0; s <= SEG; s++) {
          if (k > 0 && s === 0) continue; // 避免跨界重复点
          const t = s / SEG;
          const p = new THREE.Vector3().lerpVectors(ma, mb, t);
          p.y -= 4 * sag * t * (1 - t);
          msgAll.push(p);
        }

        // 该跨吊弦
        const spanDroppers = droppers.filter((d) => d.track === track && d.mileage > pa.mileage && d.mileage < pb.mileage);
        for (const dr of spanDroppers) {
          const t = (dr.mileage - pa.mileage) / (pb.mileage - pa.mileage);
          const top = new THREE.Vector3().lerpVectors(ma, mb, t);
          top.y -= 4 * sag * t * (1 - t);
          const bottom = this.contactWorld(dr.mileage);
          eqPos.push(top.x, top.y, top.z, bottom.x, bottom.y, bottom.z);
        }

        // 定位器：支柱腕臂端 → 接触线支持点
        const f = this.trackFrame(pa.mileage, track);
        const sideSign = pa.side === 'left' ? 1 : -1;
        const mastLat = sideSign * 3.4;
        const armEnd = new THREE.Vector3(f.x + f.nx * mastLat * 0.55, 6.55, f.z + f.nz * mastLat * 0.55);
        eqPos.push(armEnd.x, armEnd.y, armEnd.z, ca.x, ca.y, ca.z);
      }
      if (msgAll.length >= 2) {
        const msgTube = buildTube(msgAll, 0.045, 5, msgMat);
        msgTube.name = 'messenger';
        this.dynamicGroup.add(msgTube);
      }
      if (eqPos.length) {
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.Float32BufferAttribute(eqPos, 3));
        const lines = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: '#67e8f9', transparent: true, opacity: 0.9 }));
        lines.name = 'droppers';
        this.dynamicGroup.add(lines);
      }
    }
  }

  /** 取锚段分块（优先档案锚段，没有则按 1500m 切块） */
  private archiveAnchorsLike(track: TrackId): Array<{ from: number; to: number }> {
    // archive 里没直接存 anchors（由 React 传入 poles 等），这里用支柱按 ~25 跨切块
    const poles = this.archive!.poles.filter((p) => p.track === track).sort((a, b) => a.mileage - b.mileage);
    const out: Array<{ from: number; to: number }> = [];
    const CHUNK = 25;
    for (let i = 0; i < poles.length - 1; i += CHUNK) {
      out.push({ from: poles[i].mileage, to: poles[Math.min(i + CHUNK, poles.length - 1)].mileage });
    }
    return out;
  }

  private buildDefectMarkers() {
    if (!this.archive) return;
    const geo = new THREE.SphereGeometry(0.32, 16, 12);
    for (const d of this.view.defects) {
      const color = d.level === 2 ? 0xef4444 : 0xf59e0b;
      const mat = new THREE.MeshStandardMaterial({
        color,
        emissive: color,
        emissiveIntensity: 0.9,
        roughness: 0.3,
      });
      const m = new THREE.Mesh(geo, mat);
      const p = this.contactWorld(d.mileage);
      m.position.copy(p);
      m.userData.defectId = d.id;
      this.markerGroup.add(m);
      this.markerMeshes.push(m);

      // 光柱
      const beamGeo = new THREE.CylinderGeometry(0.06, 0.18, 6, 8, 1, true);
      const beamMat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.28, side: THREE.DoubleSide, depthWrite: false });
      const beam = new THREE.Mesh(beamGeo, beamMat);
      beam.position.set(p.x, p.y + 3, p.z);
      this.markerGroup.add(beam);

      // 地面环
      const ringGeo = new THREE.RingGeometry(0.7, 1.0, 28);
      const ringMat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.8, side: THREE.DoubleSide });
      const ring = new THREE.Mesh(ringGeo, ringMat);
      const f = this.trackFrame(d.mileage);
      ring.rotation.x = -Math.PI / 2;
      ring.position.set(f.x, 0.26, f.z);
      this.markerGroup.add(ring);
    }
  }

  private setLayerVisibility() {
    if (!this.settings) return;
    const s = this.settings;
    this.dynamicGroup.traverse((o) => {
      if (!(o as THREE.Mesh).isMesh && !(o as THREE.Line).isLine) return;
      const name = o.name;
      if (name === 'designWire') o.visible = s.showDesignWire;
      if (name === 'messenger') o.visible = s.showMessenger;
      if (name === 'droppers') o.visible = s.showDroppers;
    });
    this.scene.traverse((o) => {
      if (o.name === 'label') o.visible = s.showLabels;
    });
  }

  // ---------------- 受电弓 / 检测车 ----------------

  private buildPanto() {
    // 车体
    const bodyMat = new THREE.MeshStandardMaterial({ color: '#e8eef7', roughness: 0.35, metalness: 0.25 });
    const stripeMat = new THREE.MeshStandardMaterial({ color: '#1d6fe0', roughness: 0.4 });
    const body = new THREE.Mesh(new THREE.BoxGeometry(24, 2.5, 3.0), bodyMat);
    body.position.y = 1.75;
    this.carGroup.add(body);
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(24.1, 0.5, 3.06), stripeMat);
    stripe.position.y = 2.1;
    this.carGroup.add(stripe);
    // 车窗带
    const win = new THREE.Mesh(
      new THREE.BoxGeometry(20, 0.85, 3.08),
      new THREE.MeshStandardMaterial({ color: '#12304f', roughness: 0.15, metalness: 0.6 }),
    );
    win.position.y = 2.55;
    this.carGroup.add(win);
    // 车顶平台
    const roof = new THREE.Mesh(new THREE.BoxGeometry(6, 0.3, 2.4), new THREE.MeshStandardMaterial({ color: '#94a3b8' }));
    roof.position.set(2, 3.1, 0);
    this.carGroup.add(roof);

    // 受电弓臂（6 根可伸缩圆柱）
    const armMat = new THREE.MeshStandardMaterial({ color: '#1f2937', roughness: 0.4, metalness: 0.7 });
    for (let i = 0; i < 6; i++) {
      const cyl = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 1, 8), armMat);
      this.pantoGroup.add(cyl);
      this.bars.push(cyl);
    }
    // 滑板（接触头）
    this.pantoHead = new THREE.Mesh(
      new THREE.BoxGeometry(0.22, 0.1, 2.2),
      new THREE.MeshStandardMaterial({ color: '#111827', emissive: '#0e7490', emissiveIntensity: 0.4, roughness: 0.3, metalness: 0.8 }),
    );
    this.pantoGroup.add(this.pantoHead);

    // 接触点光球
    this.contactSphere = new THREE.Mesh(
      new THREE.SphereGeometry(0.16, 18, 14),
      new THREE.MeshBasicMaterial({ color: '#22d3ee' }),
    );
    this.pantoGroup.add(this.contactSphere);
    const halo = new THREE.Mesh(
      new THREE.SphereGeometry(0.34, 18, 14),
      new THREE.MeshBasicMaterial({ color: '#22d3ee', transparent: true, opacity: 0.25, depthWrite: false }),
    );
    halo.name = 'halo';
    this.contactSphere.add(halo);
  }

  private updatePanto() {
    if (!this.plan || !this.archive) return;
    const m = this.mileage;
    const f = this.trackFrame(m);

    // 车
    this.carGroup.position.set(f.x, 0, f.z);
    this.carGroup.rotation.set(0, Math.atan2(-f.tz, f.tx), 0);

    // 车顶底座两点（局部 x 前后）
    const baseCenter = new THREE.Vector3(f.x + f.tx * 2, 3.35, f.z + f.tz * 2);
    const baseL = baseCenter.clone().addScaledVector(new THREE.Vector3(f.nx, 0, f.nz), 0.8);
    const baseR = baseCenter.clone().addScaledVector(new THREE.Vector3(f.nx, 0, f.nz), -0.8);
    const head = this.contactWorld(m);
    head.y -= 0.08;
    const jointL = baseL.clone().lerp(head, 0.52);
    jointL.y += 0.5;
    const jointR = baseR.clone().lerp(head, 0.52);
    jointR.y += 0.5;

    // 0-1 下臂交叉，2-3 上臂，4-5 辅助
    setBar(this.bars[0], baseL, jointR);
    setBar(this.bars[1], baseR, jointL);
    setBar(this.bars[2], jointL, head.clone().addScaledVector(new THREE.Vector3(f.nx, 0, f.nz), 0.5));
    setBar(this.bars[3], jointR, head.clone().addScaledVector(new THREE.Vector3(f.nx, 0, f.nz), -0.5));
    setBar(this.bars[4], baseL, jointL);
    setBar(this.bars[5], baseR, jointR);

    this.pantoHead.position.copy(head);
    this.pantoHead.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), new THREE.Vector3(f.nx, 0, f.nz));
    this.contactSphere.position.copy(head);
  }

  // ---------------- 播放 / 定位 ----------------

  seek(mileage: number, immediateFrame = false) {
    if (!this.archive || !this.plan) return;
    const L = this.archive.line.totalLength;
    this.mileage = Math.max(0, Math.min(L, mileage));
    this.updatePanto();
    const head = this.contactWorld(this.mileage);
    if (immediateFrame) {
      const f = this.trackFrame(this.mileage);
      this.controls.target.copy(head);
      // 后侧方高位三分之三视角，兼顾受电弓、接触点与跨内之字/高低放大
      this.camera.position.set(
        head.x - f.tx * 17 + f.nx * 12,
        head.y + 6.2,
        head.z - f.tz * 17 + f.nz * 12,
      );
      this.controls.update();
    }
    this.onMileage?.(this.mileage);
  }

  /** 外部跳转（跨页点缺陷）：直接取景 */
  jumpTo(mileage: number) {
    this.seek(mileage, true);
  }

  nudge(deltaM: number) {
    this.seek(this.mileage + deltaM, false);
  }

  getMileage() {
    return this.mileage;
  }

  setPlaying(p: boolean) {
    this.playing = p;
    this.clockLast = performance.now();
  }
  isPlaying() {
    return this.playing;
  }
  setSpeedMul(m: number) {
    this.speedMul = m;
  }

  /** 播放帧里让相机跟随目标 */
  private followCamera(dt: number) {
    if (!this.follow) return;
    const head = this.contactWorld(this.mileage);
    const delta = head.clone().sub(this.controls.target);
    // 大跳变不做平移跟随
    if (delta.length() > 60) {
      this.jumpTo(this.mileage);
      return;
    }
    this.controls.target.add(delta);
    this.camera.position.add(delta);
    void dt;
  }

  // ---------------- 拾取 ----------------

  private handlePointerDown = (e: PointerEvent) => {
    this.downXY = { x: e.clientX, y: e.clientY };
  };

  private handlePointerUp = (e: PointerEvent) => {
    const moved = Math.hypot(e.clientX - this.downXY.x, e.clientY - this.downXY.y);
    if (moved > 6) return;
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hits = this.raycaster.intersectObjects(this.markerMeshes, false);
    if (hits.length) {
      const id = hits[0].object.userData.defectId as string;
      if (id) this.onDefectClick?.(id);
    }
  };

  private handlePointerMove = (e: PointerEvent) => {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hits = this.raycaster.intersectObjects(this.markerMeshes, false);
    this.renderer.domElement.style.cursor = hits.length ? 'pointer' : 'grab';
  };

  // ---------------- 渲染循环 ----------------

  private animate = () => {
    this.raf = requestAnimationFrame(this.animate);
    const now = performance.now();
    const dt = Math.min(0.05, (now - this.clockLast) / 1000);
    this.clockLast = now;

    if (this.playing && this.archive) {
      const L = this.archive.line.totalLength;
      this.mileage += dt * this.baseSpeed * this.speedMul;
      if (this.mileage >= L) {
        this.mileage = L;
        this.playing = false;
        this.onPlayEnd?.();
      }
      this.updatePanto();
      this.followCamera(dt);
      this.mileageCbAcc += dt;
      if (this.mileageCbAcc > 0.066) {
        this.mileageCbAcc = 0;
        this.onMileage?.(this.mileage);
      }
    }

    // 接触点呼吸
    if (this.contactSphere) {
      const s = 1 + Math.sin(now / 240) * 0.18;
      this.contactSphere.scale.setScalar(s);
    }

    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  };

  private resize() {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    if (!w || !h) return;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  }

  dispose() {
    cancelAnimationFrame(this.raf);
    this.ro.disconnect();
    const el = this.renderer.domElement;
    el.removeEventListener('pointerdown', this.handlePointerDown);
    el.removeEventListener('pointerup', this.handlePointerUp);
    el.removeEventListener('pointermove', this.handlePointerMove);
    this.controls.dispose();
    this.scene.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.geometry) mesh.geometry.dispose();
      const mat = mesh.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
      else if (mat) mat.dispose();
    });
    this.renderer.dispose();
    el.parentElement?.removeChild(el);
  }
}

// ---------------- 辅助 ----------------

function setBar(mesh: THREE.Mesh, a: THREE.Vector3, b: THREE.Vector3) {
  const dir = new THREE.Vector3().subVectors(b, a);
  const len = Math.max(0.001, dir.length());
  mesh.position.copy(a).add(b).multiplyScalar(0.5);
  mesh.scale.set(1, len, 1);
  mesh.quaternion.setFromUnitVectors(UP, dir.normalize());
}

/** 沿点列扫掠低边数圆管（自带稳定标架，无 Catmull 过冲） */
function buildTube(points: THREE.Vector3[], radius: number, radial: number, material: THREE.Material): THREE.Mesh {
  const n = points.length;
  if (n < 2) return new THREE.Mesh(new THREE.BufferGeometry(), material);
  const positions = new Float32Array(n * radial * 3);
  const normals = new Float32Array(n * radial * 3);
  const indices: number[] = [];

  const tangents: THREE.Vector3[] = new Array(n);
  for (let i = 0; i < n; i++) {
    const prev = points[Math.max(0, i - 1)];
    const next = points[Math.min(n - 1, i + 1)];
    tangents[i] = new THREE.Vector3().subVectors(next, prev).normalize();
    if (tangents[i].lengthSq() < 1e-8) tangents[i].set(1, 0, 0);
  }

  for (let i = 0; i < n; i++) {
    const t = tangents[i];
    // 水平侧向量 = UP × t
    const side = new THREE.Vector3().crossVectors(UP, t);
    if (side.lengthSq() < 1e-6) side.set(0, 0, 1);
    side.normalize();
    const upv = new THREE.Vector3().crossVectors(t, side).normalize();

    for (let j = 0; j < radial; j++) {
      const a = (j / radial) * Math.PI * 2;
      const nx = Math.cos(a) * side.x + Math.sin(a) * upv.x;
      const ny = Math.cos(a) * side.y + Math.sin(a) * upv.y;
      const nz = Math.cos(a) * side.z + Math.sin(a) * upv.z;
      const vi = (i * radial + j) * 3;
      positions[vi] = points[i].x + nx * radius;
      positions[vi + 1] = points[i].y + ny * radius;
      positions[vi + 2] = points[i].z + nz * radius;
      normals[vi] = nx;
      normals[vi + 1] = ny;
      normals[vi + 2] = nz;
    }

    if (i < n - 1) {
      for (let j = 0; j < radial; j++) {
        const a = i * radial + j;
        const b = i * radial + ((j + 1) % radial);
        const c = (i + 1) * radial + j;
        const d = (i + 1) * radial + ((j + 1) % radial);
        indices.push(a, c, b, b, c, d);
      }
    }
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  g.setIndex(indices);
  return new THREE.Mesh(g, material);
}

/** 里程处 run 采样插值 */
export function sampleRunAt(run: DetectionRun, mileage: number): { height: number; pull: number; speed: number } {
  const xs = run.fixedMileage;
  let i = bisectLeft(xs, mileage);
  if (i <= 0) i = 1;
  if (i >= run.pointCount) i = run.pointCount - 1;
  const i0 = i - 1;
  const x0 = xs[i0];
  const x1 = xs[i];
  const t = x1 === x0 ? 0 : Math.max(0, Math.min(1, (mileage - x0) / (x1 - x0)));
  return {
    height: run.height[i0] + (run.height[i] - run.height[i0]) * t,
    pull: run.pull[i0] + (run.pull[i] - run.pull[i0]) * t,
    speed: run.speed[i0] + (run.speed[i] - run.speed[i0]) * t,
  };
}

/** 轨枕贴图：u 方向一个周期代表 4m，含 5 根轨枕 */
function makeSleeperTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 64;
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, 256, 64);
  // 道砟垫层
  ctx.fillStyle = 'rgba(96,108,128,0.55)';
  ctx.fillRect(0, 10, 256, 44);
  // 5 根轨枕（沿 x = 里程方向）
  for (let i = 0; i < 5; i++) {
    const x = i * 51.2 + 18;
    ctx.fillStyle = '#39445a';
    ctx.fillRect(x, 6, 15, 52);
    ctx.fillStyle = 'rgba(255,255,255,0.10)';
    ctx.fillRect(x, 6, 15, 4);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Canvas 文字 Sprite */
function makeTextSprite(text: string, color = '#fff'): THREE.Sprite {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d')!;
  const font = 'bold 64px "Microsoft YaHei", sans-serif';
  ctx.font = font;
  const tw = ctx.measureText(text).width;
  canvas.width = Math.ceil(tw + 60);
  canvas.height = 128;
  const c2 = canvas.getContext('2d')!;
  c2.font = font;
  c2.fillStyle = 'rgba(8,20,42,0.72)';
  roundRect(c2, 6, 18, canvas.width - 12, 92, 20);
  c2.fill();
  c2.strokeStyle = 'rgba(125,211,252,0.7)';
  c2.lineWidth = 3;
  roundRect(c2, 6, 18, canvas.width - 12, 92, 20);
  c2.stroke();
  c2.fillStyle = color;
  c2.textBaseline = 'middle';
  c2.textAlign = 'center';
  c2.fillText(text, canvas.width / 2, 66);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false });
  const sp = new THREE.Sprite(mat);
  return sp;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
