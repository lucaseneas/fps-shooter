import type { BoxDef, MapGeometry, SpawnPoint } from "./mapData";
import { defaultPracaGeometry, geometryPlayBound } from "./customMap";

/** Colisão + spawns do mapa ativo nesta instância (cliente: 1 partida). */
export interface MapCollision {
  id: string;
  label: string;
  boxes: BoxDef[];
  mapSize: number;
  playBound: number;
  spawns: SpawnPoint[];
}

export function geometryToCollision(geo: MapGeometry, label?: string): MapCollision {
  return {
    id: geo.id,
    label: label ?? geo.id,
    boxes: geo.boxes,
    mapSize: geo.mapSize,
    playBound: geometryPlayBound(geo),
    spawns: geo.spawns.length > 0 ? geo.spawns : [{ x: 0, z: 0 }],
  };
}

let activeGeo: MapGeometry = defaultPracaGeometry();
let active = geometryToCollision(activeGeo, "Praça");

export function getActiveMap(): MapCollision {
  return active;
}

export function getActiveMapGeometry(): MapGeometry {
  return activeGeo;
}

export function setActiveMap(next: MapCollision): void {
  active = next;
}

export function setActiveMapGeometry(geo: MapGeometry, label?: string): void {
  activeGeo = geo;
  active = geometryToCollision(geo, label);
}

export function resetActiveMap(): void {
  activeGeo = defaultPracaGeometry();
  active = geometryToCollision(activeGeo, "Praça");
}
