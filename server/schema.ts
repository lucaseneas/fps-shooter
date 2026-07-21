import { Schema, MapSchema, type } from "@colyseus/schema";

export class PlayerState extends Schema {
  @type("string") name = "";
  @type("number") x = 0;
  @type("number") y = 0;
  @type("number") z = 0;
  @type("number") yaw = 0;
  @type("number") health = 100;
  @type("number") kills = 0;
  @type("number") deaths = 0;
  @type("boolean") alive = true;
  // Reconciliação do movimento (apenas humanos):
  /** Velocidade vertical da simulação server-side. */
  @type("number") vy = 0;
  @type("boolean") grounded = true;
  /** Último input processado pelo servidor (ack para o replay do cliente). */
  @type("number") lastSeq = 0;
}

export class MatchState extends Schema {
  @type({ map: PlayerState }) players = new MapSchema<PlayerState>();
  @type("boolean") matchOver = false;
  @type("string") winnerName = "";
}
