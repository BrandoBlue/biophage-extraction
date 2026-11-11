/**
 * The live 3D stage behind the Hive main menu: Rendering's lab chamber (src/render/hivelab.ts) with the current
 * host's body (Creature's createHostBody) idling on the pedestal while the camera turns slowly around it.
 * It takes over the pipeline only while it is active and hands the raid scene back when it stops.
 */
import * as THREE from 'three';
import type { ClassId } from '../../data';
import { createHostBody, type HostBody } from '../creatures/hosts';
import { createHiveLab, type HiveLab } from '../render/hivelab';
import { HIVE } from '../render/palette';
import type { Pipeline } from '../render/pipeline';

/**
 * Menu framing: closer than the lab's default so the ~2 m host fills the specimen column. Turntable speed (rad/s) and
 * starting yaw give a slow three-quarter view like the reference portrait. The fill is a soft bone light that follows
 * the camera, so the host's face never turns into the dark.
 */
export const STAGE = { dist: 7, eyeY: 1.9, lookY: 1.55, spin: 0.12, yaw: 0.35, fill: 22, testFrameMs: 2500 };

export class HiveStage {
  private lab: HiveLab | null = null;
  private body: HostBody | null = null;
  private yaw = STAGE.yaw;
  private fill = new THREE.PointLight(HIVE.bone, STAGE.fill, 12, 1.8);
  active = false;
  private lastDraw = -Infinity;

  constructor(private pipeline: Pipeline) {}

  /** Turns the stage on with this host on the pedestal, or off. Cheap to call every frame. */
  set(on: boolean, host: ClassId, aspect: number): void {
    if (on) {
      if (!this.lab) {
        this.lab = createHiveLab();
        this.lab.scene.add(this.fill);
        if (this.pipeline.quality === 'high') this.lab.bakeEnvironment(this.pipeline.renderer);
      }
      if (this.body?.classId !== host) {
        this.body = createHostBody(host);
        this.lab.place(this.body.root);
      }
      if (this.lab.camera.aspect !== aspect) { this.lab.camera.aspect = aspect; this.lab.camera.updateProjectionMatrix(); }
      if (!this.active) {
        this.pipeline.overrideScene = this.lab.scene;
        this.pipeline.overrideCamera = this.lab.camera;
        this.pipeline.setPreset('hive');
      }
    } else if (this.active) {
      this.pipeline.overrideScene = null;
      this.pipeline.overrideCamera = null;
      this.pipeline.setPreset('zone7');
    }
    this.active = on;
  }

  /**
   * Whether to draw the stage this frame. Automated runs (tests, playtest bot) on software rendering draw it every
   * STAGE.testFrameMs only, so a slow lab frame never stalls their clicks; players get every frame.
   */
  due(now = performance.now(), automated = navigator.webdriver): boolean {
    if (!this.active) return false;
    if (automated && now - this.lastDraw < STAGE.testFrameMs) return false;
    this.lastDraw = now;
    return true;
  }

  update(dt: number): void {
    if (!this.active || !this.lab) return;
    this.body?.update(dt);
    this.yaw += dt * STAGE.spin;
    const cam = this.lab.camera, x = Math.sin(this.yaw), z = Math.cos(this.yaw);
    cam.position.set(x * STAGE.dist, STAGE.eyeY, z * STAGE.dist);
    cam.lookAt(0, STAGE.lookY, 0);
    this.fill.position.set(x * STAGE.dist * 0.6 + z * 1.2, STAGE.eyeY + 1, z * STAGE.dist * 0.6 - x * 1.2);
  }
}
