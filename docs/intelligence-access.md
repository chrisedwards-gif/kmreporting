# Intelligence access boundary

The commercial decision-intelligence layer is a Group Chef / group-management workspace.

- `admin` and `group_manager` may view the Decision Desk and download the AI review pack.
- `kitchen_manager` users retain their own kitchen reporting, KPIs, actions and 1-1 workflow, but do not receive decision-intelligence findings, confidence scores, estimated financial impact, reconciliation detail, menu-cost intelligence or the AI review export.
- `viewer` users do not receive decision-intelligence output.
- Database RLS mirrors the application boundary for the intelligence-specific tables.
