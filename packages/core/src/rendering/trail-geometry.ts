import * as THREE from "three";

/** A bounded sample reuses the point motion shader without doubling the full cloud. */
export function createTrailGeometry(
  source: THREE.BufferGeometry,
): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  const pointCount = source.getAttribute("position").count;
  const trailCount = Math.min(16384, pointCount);
  for (const name of [
    "position",
    "targetPosition",
    "pointColor",
    "targetColor",
    "pointSeed",
  ]) {
    const attribute = source.getAttribute(name);
    const values = new Float32Array(trailCount * 2 * attribute.itemSize);
    for (let index = 0; index < trailCount; index++) {
      const sourceIndex = Math.floor((index * pointCount) / trailCount);
      for (let component = 0; component < attribute.itemSize; component++) {
        const value = attribute.getComponent(sourceIndex, component);
        values[index * 2 * attribute.itemSize + component] = value;
        values[(index * 2 + 1) * attribute.itemSize + component] = value;
      }
    }
    geometry.setAttribute(
      name,
      new THREE.BufferAttribute(values, attribute.itemSize),
    );
  }
  const ends = new Float32Array(trailCount * 2);
  for (let index = 1; index < ends.length; index += 2) ends[index] = 1;
  geometry.setAttribute("trailEnd", new THREE.BufferAttribute(ends, 1));
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 10);
  return geometry;
}
