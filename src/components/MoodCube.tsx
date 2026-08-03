"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import * as THREE from "three";

export interface MoodCubeEntry {
  id: number;
  artist: string;
  title: string;
  genres: string[];
  styles: string[];
  moodAxes: { approachability: number; valence: number; density: number };
}

export interface MoodCubeGenreGroup {
  genre: string;
  styles: string[];
}

// Categorical palette for coloring points by genre — purely visual
// clustering, not stored anywhere.
const PALETTE = [
  0x1d9e75, 0xd85a30, 0x378add, 0x639922, 0xba7517, 0x534ab7, 0xd4537e, 0x888780, 0xe24b4a,
];

const HEIGHT = 480;
const SELECT_CLASS =
  "rounded-full bg-white px-4 py-2 text-sm text-zinc-700 shadow-[0_0_0_1px_rgba(0,0,0,0.08)] outline-none dark:bg-zinc-900 dark:text-zinc-200 dark:shadow-[0_0_0_1px_rgba(255,255,255,0.12)]";
// Non-breaking space so indentation survives whitespace collapsing in <option> rendering.
const INDENT = "    ";

export function MoodCube({
  entries,
  genreGroups,
}: {
  entries: MoodCubeEntry[];
  genreGroups: MoodCubeGenreGroup[];
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const tooltipRef = useRef<HTMLDivElement | null>(null);
  const router = useRouter();
  const [filter, setFilter] = useState("");

  // A style's color always follows its parent genre; a release colored by
  // its own genre tag falls back to the style's parent when it has no
  // genre-kind tag of its own attached directly.
  const styleToGenre = useMemo(() => {
    const map = new Map<string, string>();
    for (const g of genreGroups) for (const s of g.styles) map.set(s, g.genre);
    return map;
  }, [genreGroups]);

  const colorKeyFor = useCallback(
    (e: MoodCubeEntry) => e.genres[0] ?? styleToGenre.get(e.styles[0] ?? "") ?? "Unknown",
    [styleToGenre],
  );

  // Computed from the full (unfiltered) collection so a genre's color never
  // shifts depending on what the current filter happens to include.
  const primaryGenres = useMemo(
    () => [...new Set(entries.map(colorKeyFor))].sort(),
    [entries, colorKeyFor],
  );

  const filteredEntries = useMemo(() => {
    if (!filter) return entries;
    return entries.filter((e) => e.genres.includes(filter) || e.styles.includes(filter));
  }, [entries, filter]);

  useEffect(() => {
    const container = containerRef.current;
    const tooltipEl = tooltipRef.current;
    if (!container || !tooltipEl) return;
    const tooltip: HTMLDivElement = tooltipEl;

    const width = container.clientWidth;
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(45, width / HEIGHT, 0.1, 100);
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(width, HEIGHT);
    renderer.setPixelRatio(window.devicePixelRatio || 1);
    container.appendChild(renderer.domElement);

    const cubeGeo = new THREE.BoxGeometry(2, 2, 2);
    const edges = new THREE.EdgesGeometry(cubeGeo);
    scene.add(new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: 0x888780 })));

    function axisLine(dir: [number, number, number], color: number) {
      const points = [
        new THREE.Vector3(-dir[0], -dir[1], -dir[2]),
        new THREE.Vector3(dir[0], dir[1], dir[2]),
      ];
      const geo = new THREE.BufferGeometry().setFromPoints(points);
      return new THREE.Line(geo, new THREE.LineBasicMaterial({ color }));
    }
    scene.add(axisLine([1.15, 0, 0], 0xd85a30)); // x = valence
    scene.add(axisLine([0, 1.15, 0], 0x639922)); // y = approachability
    scene.add(axisLine([0, 0, 1.15], 0x378add)); // z = density

    const paletteIndexForGenre = (genre: string) => primaryGenres.indexOf(genre) % PALETTE.length;

    // One InstancedMesh per palette color (not per-instance vertex colors —
    // per-instance color on InstancedMesh renders solid black with
    // MeshBasicMaterial on the three.js version this project pins; grouping
    // by color bucket sidesteps that entirely and is just as cheap to draw).
    const sphereGeo = new THREE.SphereGeometry(0.045, 8, 8);
    const matrix = new THREE.Matrix4();
    const meshEntries: { mesh: THREE.InstancedMesh; group: MoodCubeEntry[] }[] = [];
    PALETTE.forEach((hex, paletteIndex) => {
      const group = filteredEntries.filter((e) => paletteIndexForGenre(colorKeyFor(e)) === paletteIndex);
      if (group.length === 0) return;
      const mesh = new THREE.InstancedMesh(
        sphereGeo,
        new THREE.MeshBasicMaterial({ color: hex }),
        group.length,
      );
      group.forEach((entry, i) => {
        matrix.setPosition(entry.moodAxes.valence, entry.moodAxes.approachability, entry.moodAxes.density);
        mesh.setMatrixAt(i, matrix);
      });
      mesh.instanceMatrix.needsUpdate = true;
      scene.add(mesh);
      meshEntries.push({ mesh, group });
    });

    let radius = 4.2;
    let theta = 0.8;
    let phi = 1.1;
    function updateCamera() {
      camera.position.set(
        radius * Math.sin(phi) * Math.cos(theta),
        radius * Math.cos(phi),
        radius * Math.sin(phi) * Math.sin(theta),
      );
      camera.lookAt(0, 0, 0);
    }
    updateCamera();

    let dragging = false;
    let lastX = 0;
    let lastY = 0;
    let downX = 0;
    let downY = 0;
    const CLICK_MOVE_THRESHOLD = 4; // px — below this, a pointerdown+up is a click, not a rotate drag
    renderer.domElement.style.cursor = "grab";

    const raycaster = new THREE.Raycaster();
    const mouse = new THREE.Vector2();
    function pickEntryAt(clientX: number, clientY: number): MoodCubeEntry | undefined {
      const rect = renderer.domElement.getBoundingClientRect();
      mouse.x = ((clientX - rect.left) / rect.width) * 2 - 1;
      mouse.y = -((clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(mouse, camera);
      const hits = raycaster.intersectObjects(meshEntries.map((m) => m.mesh));
      if (hits.length && hits[0].instanceId !== undefined) {
        const hitMeshEntry = meshEntries.find((m) => m.mesh === hits[0].object);
        return hitMeshEntry?.group[hits[0].instanceId];
      }
      return undefined;
    }

    function onPointerDown(e: PointerEvent) {
      dragging = true;
      lastX = e.clientX;
      lastY = e.clientY;
      downX = e.clientX;
      downY = e.clientY;
      renderer.domElement.style.cursor = "grabbing";
      if (tooltip) tooltip.style.display = "none";
    }
    function onPointerUp(e: PointerEvent) {
      dragging = false;
      renderer.domElement.style.cursor = "grab";
      const moved = Math.hypot(e.clientX - downX, e.clientY - downY);
      if (moved < CLICK_MOVE_THRESHOLD) {
        const entry = pickEntryAt(e.clientX, e.clientY);
        if (entry) router.push(`/releases/${entry.id}`);
      }
    }
    function onPointerMove(e: PointerEvent) {
      const rect = renderer.domElement.getBoundingClientRect();
      if (dragging) {
        theta += (e.clientX - lastX) * 0.008;
        phi = Math.max(0.15, Math.min(Math.PI - 0.15, phi - (e.clientY - lastY) * 0.008));
        lastX = e.clientX;
        lastY = e.clientY;
        updateCamera();
        return;
      }
      if (
        e.clientX < rect.left ||
        e.clientX > rect.right ||
        e.clientY < rect.top ||
        e.clientY > rect.bottom
      ) {
        tooltip.style.display = "none";
        return;
      }
      const entry = pickEntryAt(e.clientX, e.clientY);
      if (entry) {
        tooltip.textContent = `${entry.title} — ${entry.artist}`;
        tooltip.style.left = `${e.clientX - rect.left + 12}px`;
        tooltip.style.top = `${e.clientY - rect.top + 12}px`;
        tooltip.style.display = "block";
        renderer.domElement.style.cursor = "pointer";
      } else {
        tooltip.style.display = "none";
        renderer.domElement.style.cursor = "grab";
      }
    }
    function onWheel(e: WheelEvent) {
      e.preventDefault();
      radius = Math.max(2, Math.min(10, radius + e.deltaY * 0.003));
      updateCamera();
    }

    renderer.domElement.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointermove", onPointerMove);
    renderer.domElement.addEventListener("wheel", onWheel, { passive: false });

    function onResize() {
      const w = container!.clientWidth;
      camera.aspect = w / HEIGHT;
      camera.updateProjectionMatrix();
      renderer.setSize(w, HEIGHT);
    }
    window.addEventListener("resize", onResize);

    let frameId: number;
    function animate() {
      frameId = requestAnimationFrame(animate);
      renderer.render(scene, camera);
    }
    animate();

    return () => {
      cancelAnimationFrame(frameId);
      renderer.domElement.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointermove", onPointerMove);
      renderer.domElement.removeEventListener("wheel", onWheel);
      window.removeEventListener("resize", onResize);
      sphereGeo.dispose();
      meshEntries.forEach((m) => (m.mesh.material as THREE.Material).dispose());
      cubeGeo.dispose();
      edges.dispose();
      renderer.dispose();
      container!.removeChild(renderer.domElement);
    };
  }, [filteredEntries, primaryGenres, colorKeyFor, router]);

  return (
    <div>
      <div className="mb-3 flex items-center gap-2">
        <select
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className={SELECT_CLASS}
        >
          <option value="">All genres &amp; styles</option>
          {genreGroups.map((group) => (
            <Fragment key={group.genre}>
              <option value={group.genre}>{group.genre}</option>
              {group.styles.map((style) => (
                <option key={style} value={style}>
                  {INDENT}
                  {style}
                </option>
              ))}
            </Fragment>
          ))}
        </select>
        <p className="text-xs text-zinc-500">
          {filter
            ? `${filteredEntries.length} of ${entries.length} records`
            : `${entries.length} records`}
        </p>
      </div>
      <div
        ref={containerRef}
        className="relative overflow-hidden rounded-lg bg-zinc-50 dark:bg-zinc-900"
        style={{ height: HEIGHT }}
      >
        <div
          ref={tooltipRef}
          className="pointer-events-none absolute z-10 hidden rounded-md bg-white px-2 py-1 text-xs text-zinc-700 shadow-[0_0_0_1px_rgba(0,0,0,0.08)] dark:bg-zinc-800 dark:text-zinc-200 dark:shadow-[0_0_0_1px_rgba(255,255,255,0.12)]"
        />
      </div>
      <div className="mt-2 flex flex-wrap gap-4 text-xs text-zinc-500">
        <span>
          <span className="mr-1 inline-block h-2.5 w-2.5 rounded-sm bg-[#D85A30]" />
          valence (x)
        </span>
        <span>
          <span className="mr-1 inline-block h-2.5 w-2.5 rounded-sm bg-[#639922]" />
          approachability (y)
        </span>
        <span>
          <span className="mr-1 inline-block h-2.5 w-2.5 rounded-sm bg-[#378ADD]" />
          density (z)
        </span>
        <span className="ml-auto">drag to rotate · scroll to zoom · dot color = primary genre</span>
      </div>
    </div>
  );
}
