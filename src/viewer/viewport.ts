/**
 * viewport.ts — Three.js 3D viewport for mesh visualization
 *
 * Provides orbit controls, mesh rendering, and defect overlay.
 * Designed to work in the Electron renderer process.
 */

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

export class Viewport {
  private container: HTMLElement;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private renderer: THREE.WebGLRenderer;
  private controls: OrbitControls;
  private meshGroup: THREE.Group;
  private defectGroup: THREE.Group;
  private gridHelper: THREE.GridHelper;
  private axesHelper: THREE.AxesHelper;
  private ambientLight: THREE.AmbientLight;
  private directionalLight: THREE.DirectionalLight;
  private animationId: number | null = null;

  constructor(container: HTMLElement) {
    this.container = container;

    // Scene
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0d1117);
    this.scene.fog = new THREE.FogExp2(0x0d1117, 0.0005);

    // Camera
    const aspect = container.clientWidth / container.clientHeight;
    this.camera = new THREE.PerspectiveCamera(45, aspect, 0.1, 100000);
    this.camera.position.set(50, 50, 50);
    this.camera.lookAt(0, 0, 0);

    // Renderer
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      powerPreference: 'high-performance',
    });
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = false;
    container.appendChild(this.renderer.domElement);

    // Orbit Controls
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.rotateSpeed = 0.8;
    this.controls.zoomSpeed = 1.2;
    this.controls.panSpeed = 0.8;

    // Groups
    this.meshGroup = new THREE.Group();
    this.meshGroup.name = 'meshGroup';
    this.scene.add(this.meshGroup);

    this.defectGroup = new THREE.Group();
    this.defectGroup.name = 'defectGroup';
    this.scene.add(this.defectGroup);

    // Grid
    this.gridHelper = new THREE.GridHelper(200, 40, 0x1a1f2e, 0x12161f);
    this.scene.add(this.gridHelper);

    // Axes
    this.axesHelper = new THREE.AxesHelper(20);
    this.scene.add(this.axesHelper);

    // Lighting
    this.ambientLight = new THREE.AmbientLight(0x404060, 0.6);
    this.scene.add(this.ambientLight);

    this.directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
    this.directionalLight.position.set(100, 100, 50);
    this.scene.add(this.directionalLight);

    const backLight = new THREE.DirectionalLight(0x4060ff, 0.3);
    backLight.position.set(-50, -50, -50);
    this.scene.add(backLight);

    // Handle resize
    const observer = new ResizeObserver(() => this.onResize());
    observer.observe(container);

    // Start animation loop
    this.animate();
  }

  private animate = (): void => {
    this.animationId = requestAnimationFrame(this.animate);
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  };

  private onResize(): void {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    if (w === 0 || h === 0) return;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  }

  // ─── Mesh Rendering ─────────────────────────────────────────────────────

  /**
   * Load a mesh into the viewport from flat arrays.
   * @param positions Float32Array of vertex positions [x,y,z,...]
   * @param indices Uint32Array of triangle indices
   * @param wireframeIndices Optional line indices for wireframe overlay
   */
  loadMesh(
    positions: Float32Array,
    indices: Uint32Array,
    wireframeIndices?: Uint32Array,
    colors?: Float32Array,
  ): void {
    this.clearMesh();

    // Solid mesh
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    if (colors) {
      geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    }
    geometry.setIndex(new THREE.BufferAttribute(indices, 1));
    geometry.computeVertexNormals();

    const material = new THREE.MeshPhongMaterial({
      color: colors ? 0xffffff : 0x3b82f6,
      vertexColors: !!colors,
      specular: 0x111111,
      shininess: 30,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.85,
      flatShading: true,
    });

    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'solidMesh';
    this.meshGroup.add(mesh);

    // Wireframe overlay
    if (wireframeIndices) {
      const wireGeo = new THREE.BufferGeometry();
      wireGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      wireGeo.setIndex(new THREE.BufferAttribute(wireframeIndices, 1));
      const wireMat = new THREE.LineBasicMaterial({
        color: 0x64748b,
        transparent: true,
        opacity: 0.4,
      });
      const wireframe = new THREE.LineSegments(wireGeo, wireMat);
      wireframe.name = 'wireframe';
      this.meshGroup.add(wireframe);
    } else {
      // Fallback: use EdgeGeometry for wireframe
      const edgesGeo = new THREE.EdgesGeometry(geometry, 15);
      const edgesMat = new THREE.LineBasicMaterial({
        color: 0x475569,
        transparent: true,
        opacity: 0.5,
      });
      const edges = new THREE.LineSegments(edgesGeo, edgesMat);
      edges.name = 'wireframe';
      this.meshGroup.add(edges);
    }

    // Fit camera to mesh
    this.fitToView();
  }

  /**
   * Highlight defective elements with severity-coded colors.
   * @param highlights Array of { positions, severity } for each defective region
   */
  setDefectHighlights(
    highlights: Array<{
      positions: Float32Array;
      indices: Uint32Array;
      severity: number;
    }>,
  ): void {
    this.clearDefects();

    for (const h of highlights) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(h.positions, 3));
      geo.setIndex(new THREE.BufferAttribute(h.indices, 1));

      const color = this.severityColor(h.severity);
      const mat = new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.7,
        side: THREE.DoubleSide,
        depthTest: true,
      });

      const mesh = new THREE.Mesh(geo, mat);
      mesh.renderOrder = 1;
      this.defectGroup.add(mesh);

      // Add glowing outline
      const outlineGeo = new THREE.EdgesGeometry(geo, 1);
      const outlineMat = new THREE.LineBasicMaterial({
        color,
        linewidth: 2,
      });
      const outline = new THREE.LineSegments(outlineGeo, outlineMat);
      outline.renderOrder = 2;
      this.defectGroup.add(outline);
    }
  }

  /** Clear all mesh geometry */
  clearMesh(): void {
    while (this.meshGroup.children.length > 0) {
      const child = this.meshGroup.children[0];
      this.meshGroup.remove(child);
      if (child instanceof THREE.Mesh || child instanceof THREE.LineSegments) {
        child.geometry.dispose();
        if (Array.isArray(child.material)) {
          child.material.forEach((m) => m.dispose());
        } else {
          child.material.dispose();
        }
      }
    }
  }

  /** Clear defect highlights */
  clearDefects(): void {
    while (this.defectGroup.children.length > 0) {
      const child = this.defectGroup.children[0];
      this.defectGroup.remove(child);
      if (child instanceof THREE.Mesh || child instanceof THREE.LineSegments) {
        child.geometry.dispose();
        if (Array.isArray(child.material)) {
          child.material.forEach((m) => m.dispose());
        } else {
          child.material.dispose();
        }
      }
    }
  }

  /** Fly camera to focus on a specific position */
  flyTo(x: number, y: number, z: number, distance: number = 30): void {
    const target = new THREE.Vector3(x, y, z);
    const direction = new THREE.Vector3()
      .subVectors(this.camera.position, this.controls.target)
      .normalize();
    const newPos = target.clone().add(direction.multiplyScalar(distance));

    // Smooth animation
    const startPos = this.camera.position.clone();
    const startTarget = this.controls.target.clone();
    const duration = 600;
    const startTime = performance.now();

    const animateFly = (time: number) => {
      const t = Math.min((time - startTime) / duration, 1);
      const ease = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;

      this.camera.position.lerpVectors(startPos, newPos, ease);
      this.controls.target.lerpVectors(startTarget, target, ease);
      this.controls.update();

      if (t < 1) requestAnimationFrame(animateFly);
    };

    requestAnimationFrame(animateFly);
  }

  /** Fit camera to view the entire mesh */
  fitToView(): void {
    const box = new THREE.Box3().setFromObject(this.meshGroup);
    if (box.isEmpty()) return;

    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z);
    const dist = maxDim * 2;

    this.controls.target.copy(center);
    this.camera.position.set(
      center.x + dist * 0.7,
      center.y + dist * 0.5,
      center.z + dist * 0.7,
    );
    this.camera.lookAt(center);
    this.controls.update();

    // Adjust grid to match model scale
    this.gridHelper.scale.set(maxDim / 100, 1, maxDim / 100);
    this.gridHelper.position.y = box.min.y;
    this.axesHelper.scale.setScalar(maxDim * 0.1);
  }

  /** Toggle wireframe visibility */
  toggleWireframe(visible: boolean): void {
    this.meshGroup.children.forEach((child) => {
      if (child.name === 'wireframe') {
        child.visible = visible;
      }
    });
  }

  /** Toggle solid mesh visibility */
  toggleSolid(visible: boolean): void {
    this.meshGroup.children.forEach((child) => {
      if (child.name === 'solidMesh') {
        child.visible = visible;
      }
    });
  }

  /** Map severity 1-5 to a color */
  private severityColor(severity: number): number {
    switch (severity) {
      case 1: return 0x22c55e; // green
      case 2: return 0xeab308; // yellow
      case 3: return 0xf97316; // orange
      case 4: return 0xef4444; // red
      case 5: return 0xdc2626; // dark red
      default: return 0x64748b; // gray
    }
  }

  /** Clean up resources */
  dispose(): void {
    if (this.animationId !== null) {
      cancelAnimationFrame(this.animationId);
    }
    this.clearMesh();
    this.clearDefects();
    this.renderer.dispose();
    this.controls.dispose();
  }
}
