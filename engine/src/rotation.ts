import { Quaternion } from "@babylonjs/core/Maths/math.vector.js";
import { vec } from "./project.js";
import type { Quaternion as Rotation, Vec3 } from "./types.js";

/** Euler inputs are pitch (X), yaw (Y), roll (Z), in degrees. */
export function quaternionFromDegrees(degrees: Vec3): Rotation {
  vec(degrees, "Rotation degrees"); const factor = Math.PI / 180;
  const q = Quaternion.FromEulerAngles(degrees.x * factor, degrees.y * factor, degrees.z * factor);
  return { x: q.x, y: q.y, z: q.z, w: q.w };
}
export function degreesFromQuaternion(rotation: Rotation): Vec3 {
  const value = new Quaternion(rotation.x, rotation.y, rotation.z, rotation.w).toEulerAngles().scale(180 / Math.PI);
  return { x: value.x, y: value.y, z: value.z };
}
