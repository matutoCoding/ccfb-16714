// three.js 接触网三维场景构建器
// 坐标系：x=里程 y=高度 z=横向；轨道 y=0，接触线导高按放大倍数显示
import * as THREE from 'three'
import type { ExceedPoint, InspectionSample, LineArchive, Support, TrackNo } from '@/types'
import {
  contactWirePoint,
  designHeightAt,
  messengerWirePoint,
  trackPoint,
} from '@/core/geometry'

export interface SceneOptions {
  exagHeight: number
  exagStagger: number
  windowM: number // 可视窗口长度（米）
}

const COLORS = {
  contact: '#dc2626',
  messenger: '#b45309',
  dropper: '#64748b',
  pole: '#475569',
  rail: '#94a3b8',
  ground: '#e2e8f0',
  tunnel: '#7c8aa5',
  pantograph: '#2563eb',
  contactPoint: '#f59e0b',
  exceedL1: '#d97706',
  exceedL2: '#dc2626',
}

export class CatenaryScene {
  private renderer: THREE.WebGLRenderer
  private scene = new THREE.Scene()
  private camera: THREE.PerspectiveCamera
  private raf = 0
  private container: HTMLElement
  private archive: LineArchive
  private trackNo: TrackNo
  private options: SceneOptions

  private supports: Support[]
  private samples: InspectionSample[] = []
  private exceeds: ExceedPoint[] = []

  private wireLine: THREE.Line | null = null
  private messengerLine: THREE.Line | null = null
  private dropperLines: THREE.LineSegments | null = null
  private panto: THREE.Group
  private contactMarker: THREE.Mesh
  private exceedGroup = new THREE.Group()
  private mileage = 0
  private playing = false
  private speed: number
  private onTick?: (mileage: number, sample: InspectionSample | null) => void

  constructor(
    container: HTMLElement,
    archive: LineArchive,
    trackNo: TrackNo,
    options: SceneOptions,
    speed: number,
  ) {
    this.container = container
    this.archive = archive
    this.trackNo = trackNo
    this.options = options
    this.speed = speed
    this.supports = archive.supports.filter((s) => s.trackNo === trackNo)

    this.renderer = new THREE.WebGLRenderer({ antialias: true })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    this.renderer.setSize(container.clientWidth, container.clientHeight)
    container.appendChild(this.renderer.domElement)

    this.scene.background = new THREE.Color('#f1f5f9')
    this.scene.fog = new THREE.Fog('#f1f5f9', options.windowM * 0.6, options.windowM * 1.1)

    this.camera = new THREE.PerspectiveCamera(
      55,
      container.clientWidth / container.clientHeight,
      0.1,
      5000,
    )
    this.camera.position.set(-30, 12, 14)

    this.panto = this.buildPantograph()
    this.contactMarker = new THREE.Mesh(
      new THREE.SphereGeometry(0.35, 16, 16),
      new THREE.MeshBasicMaterial({ color: COLORS.contactPoint }),
    )
    this.scene.add(this.exceedGroup, this.panto, this.contactMarker)

    this.buildStaticInfrastructure()
    this.animate = this.animate.bind(this)
    this.raf = requestAnimationFrame(this.animate)
    window.addEventListener('resize', this.handleResize)
  }

  // 轨道、地面、隧道轮廓（静态，全量构建）
  private buildStaticInfrastructure() {
    const L = this.archive.totalLength
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(L + 200, 40),
      new THREE.MeshBasicMaterial({ color: COLORS.ground }),
    )
    ground.rotation.x = -Math.PI / 2
    ground.position.set(L / 2, -0.05, 0)
    this.scene.add(ground)

    // 两股道钢轨
    const railMat = new THREE.LineBasicMaterial({ color: COLORS.rail })
    for (const track of [1, 2] as TrackNo[]) {
      for (const side of [-0.75, 0.75]) {
        const pts: THREE.Vector3[] = []
        for (let m = 0; m <= L; m += 25) {
          const p = trackPoint(this.archive, track, m)
          pts.push(new THREE.Vector3(p.x, 0.05, p.z + side))
        }
        this.scene.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), railMat))
      }
    }

    // 支柱实例化（仅当前股道）
    const poleGeo = new THREE.CylinderGeometry(0.18, 0.22, 9, 8)
    const poleMat = new THREE.MeshLambertMaterial({ color: COLORS.pole })
    const poles = new THREE.InstancedMesh(poleGeo, poleMat, this.supports.length)
    const dummy = new THREE.Object3D()
    const armGeo = new THREE.BoxGeometry(0.15, 0.15, 4.2)
    const arms = new THREE.InstancedMesh(armGeo, poleMat, this.supports.length)
    this.supports.forEach((s, i) => {
      const p = trackPoint(this.archive, this.trackNo, s.mileage)
      dummy.position.set(p.x, 4.5, p.z - 3.2)
      dummy.updateMatrix()
      poles.setMatrixAt(i, dummy.matrix)
      dummy.position.set(p.x, 8.6, p.z - 1.2)
      dummy.rotation.set(0, 0, 0)
      dummy.updateMatrix()
      arms.setMatrixAt(i, dummy.matrix)
    })
    this.scene.add(poles, arms)

    // 隧道段：半透明框体
    const tunnelMat = new THREE.MeshBasicMaterial({
      color: COLORS.tunnel,
      transparent: true,
      opacity: 0.12,
      side: THREE.DoubleSide,
      depthWrite: false,
    })
    for (const t of this.archive.tunnels) {
      const len = t.endMileage - t.startMileage
      const box = new THREE.Mesh(new THREE.BoxGeometry(len, 10, 12), tunnelMat)
      const mid = trackPoint(this.archive, this.trackNo, (t.startMileage + t.endMileage) / 2)
      box.position.set(mid.x, 4.5, mid.z)
      this.scene.add(box)
    }

    // 灯光
    this.scene.add(new THREE.AmbientLight(0xffffff, 1.1))
    const dir = new THREE.DirectionalLight(0xffffff, 0.8)
    dir.position.set(100, 200, 80)
    this.scene.add(dir)
  }

  private buildPantograph(): THREE.Group {
    const g = new THREE.Group()
    const mat = new THREE.MeshLambertMaterial({ color: COLORS.pantograph })
    // 底盘
    const base = new THREE.Mesh(new THREE.BoxGeometry(3, 0.3, 1.8), mat)
    base.position.y = 0.5
    g.add(base)
    // 菱形臂架
    const armPts = [
      new THREE.Vector3(-1.2, 0.6, 0),
      new THREE.Vector3(0, 2.4, 0),
      new THREE.Vector3(1.2, 0.6, 0),
    ]
    const arm = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(armPts),
      new THREE.LineBasicMaterial({ color: COLORS.pantograph }),
    )
    g.add(arm)
    // 滑板（弓头）
    const strip = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.12, 1.9), mat)
    strip.position.y = 2.5
    g.add(strip)
    return g
  }

  // 载入检测数据并重建接触线/承力索/吊弦
  setData(samples: InspectionSample[], exceeds: ExceedPoint[]) {
    this.samples = samples
    this.exceeds = exceeds
    this.rebuildWires()
    this.rebuildExceedMarkers()
  }

  private rebuildWires() {
    if (this.wireLine) {
      this.scene.remove(this.wireLine, this.messengerLine!, this.dropperLines!)
      this.wireLine.geometry.dispose()
      ;(this.wireLine.material as THREE.Material).dispose()
      this.messengerLine?.geometry.dispose()
      ;(this.messengerLine?.material as THREE.Material | undefined)?.dispose()
      this.dropperLines?.geometry.dispose()
      ;(this.dropperLines?.material as THREE.Material | undefined)?.dispose()
    }
    const { exagHeight: eh, exagStagger: es } = this.options

    const contactPts = this.samples.map((s) => {
      const p = contactWirePoint(
        this.archive, this.trackNo, this.supports, s.mileage, s.heightMm, s.staggerMm, eh, es,
      )
      return new THREE.Vector3(p.x, p.y, p.z)
    })
    this.wireLine = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(contactPts),
      new THREE.LineBasicMaterial({ color: COLORS.contact }),
    )

    const messengerPts: THREE.Vector3[] = []
    for (let m = 0; m <= this.archive.totalLength; m += 2) {
      const p = messengerWirePoint(this.archive, this.trackNo, this.supports, m, eh)
      messengerPts.push(new THREE.Vector3(p.x, p.y, p.z))
    }
    this.messengerLine = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(messengerPts),
      new THREE.LineBasicMaterial({ color: COLORS.messenger }),
    )

    // 吊弦：每跨按档案位置在承力索与接触线之间连线
    const supportIdSet = new Set(this.supports.map((s) => s.id))
    const dropperPts: THREE.Vector3[] = []
    for (const spec of this.archive.droppers) {
      const support = this.supports.find((s) => s.id === spec.spanStartSupportId)
      if (!support || !supportIdSet.has(spec.spanStartSupportId)) continue
      for (const pos of spec.positionsInSpan) {
        const m = support.mileage + pos
        const top = messengerWirePoint(this.archive, this.trackNo, this.supports, m, eh)
        const base = trackPoint(this.archive, this.trackNo, m)
        const bottomY = (designHeightAt(this.archive, m) / 1000) * eh
        dropperPts.push(
          new THREE.Vector3(top.x, top.y, top.z),
          new THREE.Vector3(base.x, bottomY, base.z),
        )
      }
    }
    this.dropperLines = new THREE.LineSegments(
      new THREE.BufferGeometry().setFromPoints(dropperPts),
      new THREE.LineBasicMaterial({ color: COLORS.dropper }),
    )
    this.scene.add(this.wireLine, this.messengerLine, this.dropperLines)
  }

  private rebuildExceedMarkers() {
    for (const child of this.exceedGroup.children) {
      if (child instanceof THREE.Mesh) {
        child.geometry.dispose()
        ;(child.material as THREE.Material).dispose()
      }
    }
    this.exceedGroup.clear()
    for (const e of this.exceeds) {
      const color = e.level === 2 ? COLORS.exceedL2 : COLORS.exceedL1
      const marker = new THREE.Mesh(
        new THREE.CylinderGeometry(0.4, 0.4, 12, 10, 1, true),
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.55, side: THREE.DoubleSide }),
      )
      const p = trackPoint(this.archive, this.trackNo, e.maxMileage)
      marker.position.set(p.x, 6, p.z)
      marker.userData = { exceedId: e.id, mileage: e.maxMileage }
      this.exceedGroup.add(marker)
    }
  }

  setExaggeration(exagHeight: number, exagStagger: number) {
    this.options = { ...this.options, exagHeight, exagStagger }
    this.rebuildWires()
  }

  setSpeed(speed: number) {
    this.speed = speed
  }

  onFrame(cb: (mileage: number, sample: InspectionSample | null) => void) {
    this.onTick = cb
  }

  private sampleAt(mileage: number): InspectionSample | null {
    if (this.samples.length === 0) return null
    let lo = 0
    let hi = this.samples.length - 1
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (this.samples[mid].mileage < mileage) lo = mid + 1
      else hi = mid
    }
    return this.samples[lo] ?? null
  }

  seek(mileage: number) {
    this.mileage = Math.max(0, Math.min(this.archive.totalLength, mileage))
    this.updatePanto()
  }

  play() {
    this.playing = true
  }

  pause() {
    this.playing = false
  }

  get isPlaying() {
    return this.playing
  }

  private updatePanto() {
    const s = this.sampleAt(this.mileage)
    const base = trackPoint(this.archive, this.trackNo, this.mileage)
    this.panto.position.set(base.x, 0, base.z)
    if (s) {
      const wp = contactWirePoint(
        this.archive, this.trackNo, this.supports, s.mileage,
        s.heightMm, s.staggerMm, this.options.exagHeight, this.options.exagStagger,
      )
      this.contactMarker.position.set(wp.x, wp.y, wp.z)
    }
    // 相机跟随
    this.camera.position.set(base.x - 28, 11, base.z + 13)
    this.camera.lookAt(base.x + 8, 6, base.z)
    this.onTick?.(this.mileage, s)
  }

  private lastTime = 0
  private animate(time: number) {
    this.raf = requestAnimationFrame(this.animate)
    const dt = this.lastTime ? Math.min((time - this.lastTime) / 1000, 0.1) : 0
    this.lastTime = time
    if (this.playing) {
      this.mileage += this.speed * dt
      if (this.mileage >= this.archive.totalLength) {
        this.mileage = this.archive.totalLength
        this.playing = false
      }
      this.updatePanto()
    }
    this.renderer.render(this.scene, this.camera)
  }

  private handleResize = () => {
    const w = this.container.clientWidth
    const h = this.container.clientHeight
    this.camera.aspect = w / h
    this.camera.updateProjectionMatrix()
    this.renderer.setSize(w, h)
  }

  dispose() {
    cancelAnimationFrame(this.raf)
    window.removeEventListener('resize', this.handleResize)
    this.renderer.dispose()
    this.renderer.domElement.remove()
  }
}
