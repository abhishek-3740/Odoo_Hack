import React, { useRef, useMemo } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { PerspectiveCamera, Float } from '@react-three/drei';
import * as THREE from 'three';

/*
 * DealFlow360 — Hero 3D scene
 *
 * Concept: the product is a quotation-to-cash pipeline. Quotes move through
 * four stages (Pricing → Negotiation → Approval → Acceptance). The scene
 * renders that pipeline as a luminous conduit: nodes flow along a path,
 * passing through stage gates that pulse as they accept and release.
 *
 * No random spheres, no blobs. Every visual is the product metaphor.
 */

// Bezier path for the quotation flow, runs through 4 stage positions
const PIPELINE_CURVE = new THREE.CatmullRomCurve3([
  new THREE.Vector3(-7.5, -0.6, -1.5),
  new THREE.Vector3(-4.0, 0.2, -0.6),
  new THREE.Vector3(-1.5, -0.4, 0.4),
  new THREE.Vector3(1.5, 0.6, -0.2),
  new THREE.Vector3(4.0, -0.2, 0.6),
  new THREE.Vector3(7.5, 0.4, -0.6),
]);

// 4 stages along the curve (parameter t on [0, 1])
const STAGE_T = [0.18, 0.42, 0.66, 0.88];

/* -------------------------------------------------------------------------- */
/* Quotation nodes — small luminous spheres that travel the curve             */
/* -------------------------------------------------------------------------- */
function FlowNodes({ count = 18, reducedMotion = false }) {
  const meshRef = useRef();
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const seeds = useMemo(
    () =>
      Array.from({ length: count }, (_, i) => ({
        offset: i / count,
        speed: 0.04 + Math.random() * 0.02,
        size: 0.055 + Math.random() * 0.035,
      })),
    [count]
  );

  useFrame(({ clock }) => {
    if (!meshRef.current) return;
    const t = clock.getElapsedTime();
    seeds.forEach((seed, i) => {
      const progress = reducedMotion
        ? seed.offset
        : (seed.offset + t * seed.speed) % 1;
      const pos = PIPELINE_CURVE.getPointAt(progress);
      dummy.position.copy(pos);
      const pulse = 1 + Math.sin(t * 2 + i) * 0.12;
      dummy.scale.setScalar(seed.size * pulse);
      dummy.updateMatrix();
      meshRef.current.setMatrixAt(i, dummy.matrix);
    });
    meshRef.current.instanceMatrix.needsUpdate = true;
  });

  return (
    <instancedMesh ref={meshRef} args={[null, null, count]} frustumCulled={false}>
      <sphereGeometry args={[1, 16, 16]} />
      <meshStandardMaterial
        color="#a5b4fc"
        emissive="#6366f1"
        emissiveIntensity={1.4}
        toneMapped={false}
      />
    </instancedMesh>
  );
}

/* -------------------------------------------------------------------------- */
/* Stage gates — the four checkpoints the pipeline passes through             */
/* -------------------------------------------------------------------------- */
function StageGates({ reducedMotion = false }) {
  const groupRef = useRef();
  const torusRef = useRef([]);

  const stagePositions = useMemo(
    () => STAGE_T.map((t) => PIPELINE_CURVE.getPointAt(t)),
    []
  );
  const stageTangents = useMemo(
    () => STAGE_T.map((t) => PIPELINE_CURVE.getTangentAt(t)),
    []
  );

  useFrame(({ clock }) => {
    if (reducedMotion || !groupRef.current) return;
    const t = clock.getElapsedTime();
    torusRef.current.forEach((torus, i) => {
      if (!torus) return;
      const phase = t * 0.7 + i * 1.4;
      const scale = 1 + Math.sin(phase) * 0.07;
      torus.scale.setScalar(scale);
      torus.material.emissiveIntensity = 0.8 + Math.sin(phase) * 0.35;
    });
  });

  return (
    <group ref={groupRef}>
      {stagePositions.map((pos, i) => {
        const tangent = stageTangents[i];
        const quaternion = new THREE.Quaternion().setFromUnitVectors(
          new THREE.Vector3(0, 0, 1),
          tangent.clone().normalize()
        );
        return (
          <group key={i} position={pos} quaternion={quaternion}>
            <mesh
              ref={(el) => (torusRef.current[i] = el)}
              rotation={[0, 0, 0]}
            >
              <torusGeometry args={[0.55, 0.018, 16, 64]} />
              <meshStandardMaterial
                color="#e0e7ff"
                emissive="#818cf8"
                emissiveIntensity={1.0}
                metalness={0.4}
                roughness={0.3}
                toneMapped={false}
              />
            </mesh>
            {/* Soft halo behind each gate */}
            <mesh position={[0, 0, -0.05]}>
              <circleGeometry args={[0.9, 32]} />
              <meshBasicMaterial
                color="#4f46e5"
                transparent
                opacity={0.18}
                side={THREE.DoubleSide}
              />
            </mesh>
          </group>
        );
      })}
    </group>
  );
}

/* -------------------------------------------------------------------------- */
/* The pipeline conduit itself — a soft tube the nodes travel through         */
/* -------------------------------------------------------------------------- */
function PipelineConduit() {
  const geometry = useMemo(
    () => new THREE.TubeGeometry(PIPELINE_CURVE, 200, 0.025, 12, false),
    []
  );
  return (
    <mesh geometry={geometry}>
      <meshStandardMaterial
        color="#c7d2fe"
        emissive="#6366f1"
        emissiveIntensity={0.7}
        transparent
        opacity={0.85}
        toneMapped={false}
      />
    </mesh>
  );
}

/* -------------------------------------------------------------------------- */
/* Ambient particle field — restrained, atmospheric                           */
/* -------------------------------------------------------------------------- */
function AmbientParticles({ count = 220, reducedMotion = false }) {
  const pointsRef = useRef();
  const positions = useMemo(() => {
    const arr = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      arr[i * 3 + 0] = (Math.random() - 0.5) * 24;
      arr[i * 3 + 1] = (Math.random() - 0.5) * 12;
      arr[i * 3 + 2] = (Math.random() - 0.5) * 8 - 2;
    }
    return arr;
  }, [count]);

  useFrame(({ clock }) => {
    if (reducedMotion || !pointsRef.current) return;
    const t = clock.getElapsedTime();
    pointsRef.current.rotation.y = t * 0.015;
  });

  return (
    <points ref={pointsRef}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" count={count} array={positions} itemSize={3} />
      </bufferGeometry>
      <pointsMaterial
        size={0.02}
        color="#818cf8"
        transparent
        opacity={0.55}
        sizeAttenuation
        depthWrite={false}
      />
    </points>
  );
}

/* -------------------------------------------------------------------------- */
/* Camera rig — cinematic framing + mouse parallax + scroll drift             */
/* -------------------------------------------------------------------------- */
function CameraRig({ mouseRef, scrollRef, reducedMotion }) {
  const camRef = useRef();
  const target = useMemo(() => new THREE.Vector3(0, 0, 0), []);

  useFrame(() => {
    if (!camRef.current) return;
    const [mx, my] = mouseRef.current;
    const scroll = scrollRef.current; // 0..1 across the page

    // Scroll moves camera: pull back and slightly down as user reads on
    const baseZ = 9.5 - scroll * 1.4;
    const baseY = 0.4 + scroll * 0.9;

    // Mouse parallax (lerped — never snap)
    const targetX = reducedMotion ? 0 : mx * 0.7;
    const targetY = reducedMotion ? baseY : baseY + my * -0.4;

    camRef.current.position.x = THREE.MathUtils.lerp(
      camRef.current.position.x,
      targetX,
      0.045
    );
    camRef.current.position.y = THREE.MathUtils.lerp(
      camRef.current.position.y,
      targetY,
      0.045
    );
    camRef.current.position.z = THREE.MathUtils.lerp(
      camRef.current.position.z,
      baseZ,
      0.05
    );
    camRef.current.lookAt(target);
  });

  return (
    <PerspectiveCamera
      ref={camRef}
      makeDefault
      position={[0, 0.4, 9.5]}
      fov={42}
      near={0.1}
      far={60}
    />
  );
}

/* -------------------------------------------------------------------------- */
/* Main scene export                                                          */
/* -------------------------------------------------------------------------- */
export function HeroScene({ mouseRef, scrollRef, reducedMotion = false }) {
  return (
    <Canvas
      dpr={[1, 1.8]}
      gl={{
        antialias: true,
        alpha: true,
        powerPreference: 'high-performance',
      }}
      style={{ position: 'absolute', inset: 0 }}
    >
      <CameraRig
        mouseRef={mouseRef}
        scrollRef={scrollRef}
        reducedMotion={reducedMotion}
      />

      {/* Lighting: cool ambient + warm key + subtle rim */}
      <ambientLight intensity={0.35} color="#e0e7ff" />
      <directionalLight position={[5, 6, 5]} intensity={1.2} color="#fef3c7" />
      <directionalLight position={[-5, -3, -5]} intensity={0.5} color="#818cf8" />
      <pointLight position={[0, 2, 4]} intensity={1.0} color="#a5b4fc" distance={14} />

      {/* Atmosphere */}
      <fog attach="fog" args={['#0a0a1f', 9, 22]} />

      {/* The product metaphor, made of light */}
      <PipelineConduit />
      <StageGates reducedMotion={reducedMotion} />
      <FlowNodes count={18} reducedMotion={reducedMotion} />
      <AmbientParticles count={220} reducedMotion={reducedMotion} />

      {/* Ground plane — barely-there reflective floor */}
      <mesh position={[0, -2.2, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[40, 40]} />
        <meshStandardMaterial
          color="#0f0f2a"
          metalness={0.1}
          roughness={0.9}
          transparent
          opacity={0.5}
        />
      </mesh>
    </Canvas>
  );
}
