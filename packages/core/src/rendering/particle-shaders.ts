// Motion runs on the graphics card; JavaScript only sends a few shared settings each frame.
export const particleVertexShader = /* glsl */ `
  attribute vec3 targetPosition;
  attribute vec4 pointColor;
  attribute vec4 targetColor;
  attribute float pointSeed;
  attribute float trailEnd;
  uniform float trailPass;
  uniform vec2 scanPlane;
  uniform float elapsedSeconds;
  uniform float driftElapsedSeconds;
  uniform float transitionProgress;
  uniform float scatterAmount;
  uniform float depthStrength;
  uniform float driftStrength;
  uniform float driftSpread;
  uniform float splashStrength;
  uniform float pointSize;
  uniform float pixelRatio;
  uniform float grainScale;
  uniform float minimumGrainPixels;
  uniform vec2 depthBounds;
  uniform float pointerStrength;
  uniform float pointerRadius;
  uniform float audioLevel;
  uniform vec4 pointerWakes[6];
  uniform float viewportAspect;
  uniform vec3 sourceCenter;
  uniform vec3 targetCenter;
  uniform vec3 driftLine;
  uniform float driftSide;
  uniform float swarm;
  uniform float lightPulse;
  uniform vec3 lightColor;
  uniform float tone;
  varying vec4 particleColor;
  varying float fading;
  varying float grainBrightness;
  varying float grainCoverage;
  varying float nearness;
  varying float trailOpacity;

  vec3 randomDirection(float seed) {
    vec3 value = fract(vec3(seed) * vec3(103.1, 113.69, 137.87));
    value += dot(value, value.yzx + 19.19);
    return fract((value.xxy + value.yzz) * value.zyx);
  }

  void main() {
    vec3 random = randomDirection(pointSeed + float(gl_InstanceID) * 0.371);
    vec3 direction = random * 2.0 - 1.0;
    grainBrightness = 0.75 + random.y * 0.25;

    // Each point leaves and returns at its own time instead of moving as a sheet.
    float blend = 1.0;
    vec3 home = targetPosition - targetCenter;
    home.z *= depthStrength;
    if (transitionProgress < 1.0 || scatterAmount > 0.0) {
      float delay = mix(clamp(0.5 - position.z, 0.0, 1.0) * 0.22, random.x * 0.22, swarm);
      float progress = clamp((transitionProgress - delay) / (1.0 - delay), 0.0, 1.0);
      blend = smoothstep(0.18, 1.0, progress);
      float launch = smoothstep(0.0, mix(0.4, 0.1, splashStrength), progress);
      float landing = smoothstep(0.28 + random.y * 0.14, 1.0, progress);
      float flight = launch * (1.0 - landing) + scatterAmount;
      home = mix(position - sourceCenter, targetPosition - targetCenter, blend);
      home.z *= depthStrength;
      home += direction * flight * (0.35 + splashStrength * 1.6) * mix(0.18, 1.0, swarm);
      home.xy += vec2(-direction.y, direction.x) * sin(progress * 3.14159265) * flight * 0.18;

    }

    // Extra grains share the source color and sit just around the prepared surface.
    if (gl_InstanceID > 0) home.xy += direction.xy * 0.003;
    vec2 normal = driftLine.xz;
    vec2 tangent = vec2(-normal.y, normal.x);
    float side = (dot(home.xy, normal) - driftLine.y) * driftSide;
    float affected = smoothstep(-0.08, 0.35, side);
    float cycle = fract(driftElapsedSeconds * mix(0.11, 0.2, random.z) + pointSeed);
    // A grain rests at its source before leaving, keeping the inner rim readable.
    float rest = mix(0.78, 0.18, affected);
    float departure = max(0.0, (cycle - rest) / (1.0 - rest));
    float travelDeparture = max(0.0, departure - trailEnd * trailPass * 0.2);
    float drift = affected * driftStrength * travelDeparture * travelDeparture;
    float along = dot(home.xy, tangent);
    float bend = sin(along * 3.0 + home.z * 2.0 + driftElapsedSeconds * 0.18);
    // Independent reach and crosswind open the stream into a volume farther from home.
    home.xy += normal * driftSide * drift * mix(2.0, 6.0, random.x);
    home.xy += tangent * (bend * 0.25 + direction.y * travelDeparture * driftSpread * 4.0) * drift;
    home.z += (bend * 0.2 + direction.z * travelDeparture * driftSpread * 4.0) * drift;
    trailOpacity = smoothstep(0.02, 0.2, departure) * affected * (1.0 - trailEnd * 0.7);
    home += direction * audioLevel * 0.2;

    vec4 color = mix(pointColor, targetColor, blend);
    if (tone > 0.5 && tone < 1.5) color.rgb = vec3(1.0) - color.rgb;
    if (tone > 1.5) color.rgb = lightColor * dot(color.rgb, vec3(0.2126, 0.7152, 0.0722));
    if (lightPulse > 0.0) {
      float glow = lightPulse * pow(max(0.0, 1.0 - length(home.xy - vec2(sin(pointSeed * 8.0), cos(pointSeed * 5.0))) * 0.65), 4.0);
      color.rgb = mix(color.rgb, lightColor, glow);
    }
    float scanBand = 0.0;
    if (scanPlane.y > 0.0) {
      scanBand = exp(-pow((home.z - scanPlane.x) / 0.025, 2.0)) * scanPlane.y;
      color.rgb = mix(color.rgb, lightColor, scanBand * 0.85);
    }
    particleColor = color;
    // Prepared depth from back (0) to front (1), read before motion so drifting grains keep their shade.
    nearness = clamp((mix(position.z, targetPosition.z, blend) - depthBounds.x) / max(0.0001, depthBounds.y - depthBounds.x), 0.0, 1.0);
    // Hide a departing point before its lifetime wraps back to its image position.
    float lifetimeOpacity = 1.0 - smoothstep(0.6, 1.0, departure);
    fading = mix(1.0, lifetimeOpacity, affected * step(0.0001, driftStrength));
    vec4 viewPosition = modelViewMatrix * vec4(home, 1.0);
    gl_Position = projectionMatrix * viewPosition;
    // Keep the wake under the cursor at every rotation and camera distance.
    vec2 screenPosition = gl_Position.xy / gl_Position.w;
    vec2 aspect = vec2(viewportAspect, 1.0);
    // Wake strength is shared by the draw, so idle frames skip all six exponentials per grain.
    if (pointerStrength > 0.0) {
      for (int index = 0; index < 6; index++) {
        vec4 wake = pointerWakes[index];
        if (dot(wake.zw, wake.zw) > 0.00000001) {
          vec2 separation = (screenPosition - wake.xy) * aspect;
          float falloff = exp(-dot(separation, separation) * 4.0 / (pointerRadius * pointerRadius));
          vec2 curl = vec2(-wake.w, wake.z) * (random.y - 0.5);
          gl_Position.xy += (wake.zw + curl) * falloff * pointerStrength * (0.6 + random.x) * gl_Position.w;
        }
      }
    }
    float diameter = pointSize * (1.0 + scanBand * 0.7) * (0.7 + random.z * 0.8) * pixelRatio * grainScale * (3.4 / max(0.5, -viewPosition.z));
    // A grain below the minimum would snap between pixels as it moves and flicker.
    // Draw it at the minimum instead, with its ink scaled to the area it really covers.
    gl_PointSize = clamp(diameter, minimumGrainPixels, 12.0);
    grainCoverage = min(1.0, diameter * diameter / (minimumGrainPixels * minimumGrainPixels));
  }
`;

export const particleFragmentShader = /* glsl */ `
  uniform float opacity;
  uniform float lightPaper;
  uniform float transparentBackground;
  uniform bool fadeEdges;
  uniform vec2 viewportPixels;
  uniform float trailPass;
  varying vec4 particleColor;
  varying float fading;
  varying float grainBrightness;
  varying float grainCoverage;
  varying float nearness;
  varying float trailOpacity;

  float canvasOpacity() {
    if (!fadeEdges) return 1.0;
    // Use the fragment position so long trails also disappear before reaching any edge.
    vec2 position = gl_FragCoord.xy / viewportPixels;
    vec2 edgeDistance = min(position, 1.0 - position);
    vec2 feather = smoothstep(vec2(0.015), vec2(0.21), edgeDistance);
    return feather.x * feather.y;
  }

  void main() {
    if (trailPass > 0.5) {
      float alpha = particleColor.a * opacity * fading * trailOpacity * 0.5 * canvasOpacity();
      vec3 ink = particleColor.rgb * alpha;
      gl_FragColor = vec4(mix(ink, vec3(mix(1.0, alpha, transparentBackground)) - ink, lightPaper), alpha);
      return;
    }
    float radius = length(gl_PointCoord - 0.5);
    if (radius > 0.5) discard;
    // A firm disc with a narrow soft rim reads as a solid grain, not a blur.
    float edge = 1.0 - smoothstep(0.3, 0.5, radius);
    // Nearer grains carry more ink, so relief reads without turning the picture.
    float shade = mix(0.7, 1.3, nearness);
    float coverage = min(1.0, particleColor.a * opacity * fading * edge * grainCoverage * shade) * canvasOpacity();
    if (coverage < 0.002) discard;
    // Each grain keeps a small brightness variation without changing hue.
    vec3 grain = particleColor.rgb * grainBrightness * coverage;
    gl_FragColor = vec4(mix(grain, vec3(mix(1.0, coverage, transparentBackground)) - grain, lightPaper), coverage);
    // Source point colors are already display RGB. Converting them again washes out dark regions.
  }
`;
