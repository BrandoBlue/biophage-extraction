import * as THREE from 'three';

/**
 * Bone posing helpers. Every limb segment's local +Y runs along the segment; these set bone rotations
 * so segments point where we want in world space while keeping a stable twist (the pole).
 */

const _pq = new THREE.Quaternion();
const _q = new THREE.Quaternion();
const _m = new THREE.Matrix4();
const _x = new THREE.Vector3();
const _y = new THREE.Vector3();
const _z = new THREE.Vector3();
const _a = new THREE.Vector3();
const _k = new THREE.Vector3();
const _d = new THREE.Vector3();
const _p = new THREE.Vector3();
const _e = new THREE.Vector3();
const _f = new THREE.Vector3();
const _pole = new THREE.Vector3();

/** Rotate `bone` so its +Y points along world `dir`; +Z leans toward world `pole`. Updates its matrices. */
export function aimBone(bone: THREE.Object3D, dir: THREE.Vector3, pole: THREE.Vector3): void {
  _y.copy(dir).normalize();
  _z.copy(pole).addScaledVector(_y, -pole.dot(_y));
  if (_z.lengthSq() < 1e-8) _z.set(_y.y, _y.z, _y.x).cross(_y);
  _z.normalize();
  _x.crossVectors(_y, _z);
  _m.makeBasis(_x, _y, _z);
  _q.setFromRotationMatrix(_m);
  if (bone.parent) { bone.parent.getWorldQuaternion(_pq); bone.quaternion.copy(_pq.invert().multiply(_q)); }
  else bone.quaternion.copy(_q);
  bone.updateMatrixWorld(true);
}

/**
 * Analytic two-bone IK. `upper` and `lower` are consecutive segment bones of lengths la and lb; the chain
 * end sits at lower's +Y * lb. Bends toward world `pole`. Out-of-reach targets straighten the limb toward them.
 * Returns how far the end lands from the target (0 when reachable).
 */
export function solveTwoBone(upper: THREE.Object3D, lower: THREE.Object3D, la: number, lb: number, target: THREE.Vector3, pole: THREE.Vector3): number {
  upper.getWorldPosition(_a);
  _d.subVectors(target, _a);
  const dist = _d.length();
  const reach = Math.min(Math.max(dist, Math.abs(la - lb) + 1e-4), la + lb - 1e-4);
  _d.normalize();
  // Angle at the root between the target line and the upper segment (law of cosines).
  const cosA = THREE.MathUtils.clamp((la * la + reach * reach - lb * lb) / (2 * la * reach), -1, 1);
  const sinA = Math.sqrt(1 - cosA * cosA);
  _p.copy(pole).addScaledVector(_d, -pole.dot(_d));
  if (_p.lengthSq() < 1e-8) _p.set(0, 1, 0).addScaledVector(_d, -_d.y);
  _p.normalize();
  _k.copy(_a).addScaledVector(_d, cosA * la).addScaledVector(_p, sinA * la);
  _pole.copy(_p);
  _e.copy(_a).addScaledVector(_d, reach);
  aimBone(upper, _f.subVectors(_k, _a), _pole);
  aimBone(lower, _f.subVectors(_e, _k), _pole);
  return Math.max(0, dist - reach);
}
