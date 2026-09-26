import { Matrix, Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector.js";
import type { Transform } from "./types.js";
import { plain, vector } from "./world.js";

export type Axis = "x" | "y" | "z";
export const snap = (distance: number, step: number) => step > 0 ? Math.round(distance / step) * step : distance;

/** Resize measured in world units, anchored to the opposite face (or bounds center). */
export function resizeTransform(start: Transform, bounds: { min: Vector3; max: Vector3 }, axis: Axis, side: number, distance: number, uniform: boolean, centered: boolean, minimumFactor: number): Transform {
  const extent = Math.max(0.0001, bounds.max[axis] - bounds.min[axis]);
  const factor = Math.max(minimumFactor, 1 + distance * side * (centered ? 2 : 1) / (extent * start.scale[axis]));
  const scale = vector(start.scale);
  if (uniform) scale.scaleInPlace(factor); else scale[axis] *= factor;
  const anchor = bounds.min.add(bounds.max).scale(0.5);
  if (!centered) anchor[axis] = side > 0 ? bounds.min[axis] : bounds.max[axis];
  const q = new Quaternion(start.rotation.x, start.rotation.y, start.rotation.z, start.rotation.w);
  const matrix = Matrix.Identity(); q.toRotationMatrix(matrix);
  const offset = Vector3.TransformNormal(vector(start.scale).subtract(scale).multiply(anchor), matrix);
  return { position: plain(vector(start.position).add(offset)), rotation: { ...start.rotation }, scale: plain(scale) };
}
