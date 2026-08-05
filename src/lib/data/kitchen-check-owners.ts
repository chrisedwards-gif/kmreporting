export type KitchenCheckOwnerCandidate = {
  id: string;
  name: string;
};

type OwnerSources = {
  assignmentIds: string[];
  membershipIds: string[];
  savedOwnerIds: string[];
  currentUser: KitchenCheckOwnerCandidate | null;
  profileNames: Map<string, string>;
};

/** Keep owner eligibility aligned with the site's canonical access model. */
export function resolveKitchenCheckOwners({
  assignmentIds,
  membershipIds,
  savedOwnerIds,
  currentUser,
  profileNames,
}: OwnerSources): KitchenCheckOwnerCandidate[] {
  const ids = new Set([...assignmentIds, ...membershipIds, ...savedOwnerIds]);
  if (currentUser) ids.add(currentUser.id);

  return [...ids]
    .map((id) => ({
      id,
      name: currentUser?.id === id ? currentUser.name : profileNames.get(id) ?? "Manager",
    }))
    .sort((left, right) => left.name.localeCompare(right.name));
}
