export type KitchenCheckOwnerProfile = {
  id: string;
  fullName: string;
  role: string;
  active: boolean;
};

type SelectKitchenCheckOwnersInput = {
  profiles: KitchenCheckOwnerProfile[];
  assignedProfileIds: string[];
  memberProfileIds: string[];
  savedOwnerProfileIds: string[];
  actorProfileId: string | null;
};

/**
 * Site membership is the operational source of truth for multi-site managers.
 * Primary assignments remain valid candidates, while the signed-in user is a
 * final fallback for kitchens that do not yet have a manager assignment.
 */
export function selectKitchenCheckOwners({
  profiles,
  assignedProfileIds,
  memberProfileIds,
  savedOwnerProfileIds,
  actorProfileId,
}: SelectKitchenCheckOwnersInput) {
  const eligibleManagerIds = new Set([...assignedProfileIds, ...memberProfileIds]);
  const savedOwnerIds = new Set(savedOwnerProfileIds);
  const owners = new Map<string, KitchenCheckOwnerProfile>();

  for (const profile of profiles) {
    if (profile.active && profile.role === "kitchen_manager" && eligibleManagerIds.has(profile.id)) {
      owners.set(profile.id, profile);
    }
  }

  // Keep an owner already saved on this check selectable if their assignment
  // changed after the draft was created.
  for (const profile of profiles) {
    if (savedOwnerIds.has(profile.id)) owners.set(profile.id, profile);
  }

  if (!owners.size && actorProfileId) {
    const actor = profiles.find((profile) => profile.id === actorProfileId && profile.active);
    if (actor) owners.set(actor.id, actor);
  }

  return [...owners.values()]
    .map((profile) => ({ id: profile.id, name: profile.fullName || "Team member" }))
    .sort((left, right) => left.name.localeCompare(right.name));
}
