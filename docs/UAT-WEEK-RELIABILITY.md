# Reliability release UAT week

Run this checklist on the permanent production candidate before making it the normal staff URL.

## Participants

- Group Admin: Chris
- Kitchen Manager: Warren or Scott
- Reporting Viewer: test viewer account

## Daily focus

### Day 1 — Login and persona boundaries

- Admin group view shows all active kitchens.
- Admin site mode mirrors the selected Kitchen Manager navigation and data only.
- Kitchen Manager cannot see another kitchen by navigation or copied URL.
- Viewer sees reporting insight and Management Summary only.

### Day 2 — 1-1 resilience

- Start a new 1-1, type in every section, wait for the Saved state, refresh, and confirm restoration.
- Add, edit and remove actions across multiple autosaves; confirm no duplicates.
- Disconnect the network during an edit; confirm Save failed remains visible and leaving triggers a warning.
- Reconnect, edit again, and confirm autosave recovers.
- Finalise only after low scores, action owners and deadlines satisfy validation.

### Day 3 — Long-form feedback

- Save and submit a weekly report while the sticky buttons are below the viewport.
- Save a kitchen check and product-development item.
- Confirm success and error toasts are visible without scrolling.
- Confirm inline validation remains next to the relevant form.

### Day 4 — Loading and accessibility

- Test dashboard, Kitchen workspace, People & performance, Administration and Management Summary on a throttled connection.
- Confirm skeletons match the final layout and do not cause major jumps.
- Run the Persona smoke workflow and confirm no serious or critical axe violations.
- Keyboard-walk navigation, dialogs and sticky actions.

### Day 5 — Sign-off

- Review error logs and unresolved UAT notes.
- Confirm no draft data loss, cross-site data exposure or blocked critical workflow.
- Record release owner, production commit and rollback commit.

## Release blockers

- Lost or duplicated 1-1 content
- Cross-kitchen data exposure
- A serious or critical accessibility violation
- A failed production build or fresh-database validation
- A success message that is only visible outside the current viewport
