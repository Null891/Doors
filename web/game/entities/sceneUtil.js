// sceneUtil.js — ctx doesn't carry a direct THREE.Scene reference, so
// entities derive it by walking up from any active room's group (world.js
// always parents room.group into the scene, so this is always reliable as
// long as at least one room is active).

export function sceneFromCtx(ctx) {
  const rooms = ctx.world.getActiveRooms();
  if (rooms.length === 0) return null;
  let o = rooms[0].group;
  while (o.parent) o = o.parent;
  return o;
}
