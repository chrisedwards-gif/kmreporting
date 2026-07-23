"use client";

import { useActionState, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, GripVertical, Save } from "lucide-react";
import { saveRotaDisplayOrder, type RotaTeamActionState } from "@/app/actions/rota-team";
import "./rota-order-manager.css";

export type RotaOrderPerson = {
  id: string;
  name: string;
  role: string;
  roleRank: number;
  displayOrder: number;
};

type RoleGroup = {
  role: string;
  roleRank: number;
  people: RotaOrderPerson[];
};

const initialState: RotaTeamActionState = { status: "idle", message: "" };

const normalise = (people: RotaOrderPerson[]): RoleGroup[] => {
  const byRole = new Map<string, RotaOrderPerson[]>();
  for (const person of people) {
    byRole.set(person.role, [...(byRole.get(person.role) ?? []), person]);
  }
  return [...byRole.entries()]
    .map(([role, members]) => ({
      role,
      roleRank: Math.min(...members.map((member) => member.roleRank)),
      people: [...members].sort((a, b) => a.displayOrder - b.displayOrder || a.name.localeCompare(b.name)),
    }))
    .sort((a, b) => a.roleRank - b.roleRank || a.role.localeCompare(b.role));
};

const serialize = (groups: RoleGroup[]) => groups.flatMap((group, roleIndex) =>
  group.people.map((person, personIndex) => ({
    id: person.id,
    roleRank: (roleIndex + 1) * 100,
    displayOrder: (personIndex + 1) * 10,
  })));

export function RotaOrderManager({ people }: { people: RotaOrderPerson[] }) {
  const [groups, setGroups] = useState<RoleGroup[]>(() => normalise(people));
  const [state, action, pending] = useActionState(saveRotaDisplayOrder, initialState);
  const router = useRouter();

  useEffect(() => {
    if (state.status === "success") router.refresh();
  }, [router, state.status]);

  const payload = useMemo(() => JSON.stringify(serialize(groups)), [groups]);

  const moveRole = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= groups.length) return;
    setGroups((current) => {
      const next = [...current];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  };

  const movePerson = (roleIndex: number, personIndex: number, direction: -1 | 1) => {
    setGroups((current) => current.map((group, index) => {
      if (index !== roleIndex) return group;
      const target = personIndex + direction;
      if (target < 0 || target >= group.people.length) return group;
      const peopleNext = [...group.people];
      [peopleNext[personIndex], peopleNext[target]] = [peopleNext[target], peopleNext[personIndex]];
      return { ...group, people: peopleNext };
    }));
  };

  if (!groups.length) return null;

  return (
    <section className="rota-order panel" aria-labelledby="rota-order-title">
      <div className="panel__header">
        <div>
          <p className="page-header__eyebrow">Admin display order</p>
          <h2 className="panel__title" id="rota-order-title">Put senior roles and key people where managers expect them.</h2>
          <p className="panel__subtitle">Role groups appear from top to bottom. People appear in the order shown inside each group.</p>
        </div>
      </div>

      <form action={action}>
        <input name="ordering" type="hidden" value={payload} />
        <div className="rota-order__groups">
          {groups.map((group, roleIndex) => (
            <article className="rota-order__group" key={group.role}>
              <header>
                <span className="rota-order__grip"><GripVertical aria-hidden="true" size={17} /></span>
                <strong>{group.role}</strong>
                <small>{group.people.length} person{group.people.length === 1 ? "" : "s"}</small>
                <div className="rota-order__buttons">
                  <button aria-label={`Move ${group.role} up`} className="icon-button" disabled={roleIndex === 0} onClick={() => moveRole(roleIndex, -1)} type="button"><ArrowUp size={15} /></button>
                  <button aria-label={`Move ${group.role} down`} className="icon-button" disabled={roleIndex === groups.length - 1} onClick={() => moveRole(roleIndex, 1)} type="button"><ArrowDown size={15} /></button>
                </div>
              </header>
              <ol>
                {group.people.map((person, personIndex) => (
                  <li key={person.id}>
                    <span className="rota-order__avatar">{person.name.slice(0, 1).toUpperCase()}</span>
                    <span><strong>{person.name}</strong><small>{person.role}</small></span>
                    <div className="rota-order__buttons">
                      <button aria-label={`Move ${person.name} up`} className="icon-button" disabled={personIndex === 0} onClick={() => movePerson(roleIndex, personIndex, -1)} type="button"><ArrowUp size={14} /></button>
                      <button aria-label={`Move ${person.name} down`} className="icon-button" disabled={personIndex === group.people.length - 1} onClick={() => movePerson(roleIndex, personIndex, 1)} type="button"><ArrowDown size={14} /></button>
                    </div>
                  </li>
                ))}
              </ol>
            </article>
          ))}
        </div>
        {state.status !== "idle" ? <p className={`form-message ${state.status === "error" ? "form-message--error" : "form-message--success"}`} role={state.status === "error" ? "alert" : "status"}>{state.message}</p> : null}
        <button className="button button--primary" disabled={pending} type="submit"><Save size={16} /> {pending ? "Saving order…" : "Save rota order"}</button>
      </form>
    </section>
  );
}
