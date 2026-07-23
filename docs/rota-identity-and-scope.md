# Rota identity and scope

## One person, two protected identifiers

Each rota person has a private `rota_staff_profiles.id` used by payroll and shift records. When the person also uses KM Reporting, `app_profile_id` links that private record to the exact `public.profiles.id` used for login, permissions, actions and 1-1s.

The pair is intentional:

- `app_profile_id` identifies the user account.
- `rota_staff_profiles.id` protects payroll and employment records.
- One app profile may link to only one rota person in an organisation.
- A RotaCloud refresh must preserve the app UUID link, organisation-wide scope and display order.

## Site and organisation-wide staff

Normal staff appear through an active site membership. Group staff can be marked `organisation_wide`, which creates planning memberships at every active kitchen.

- The selected primary membership receives the configured cost allocation.
- Automatically created secondary memberships receive a 0% fixed-salary allocation.
- Hourly shifts still use the permitted hourly rate where applicable.
- Organisation-wide contracted hours are not scored as a shortfall on one individual kitchen rota.

## Location statuses

A person can be shown without a kitchen shift as:

- Off-site admin
- Head office
- Other kitchen
- Day off
- Unavailable
- Leave
- Training

Location statuses remain auditable and are included in CSV/copy handoff. They do not count as site cover or site working hours.

## Display order

Management controls two values:

1. `role_rank` — lower values appear higher in the rota.
2. `display_order` — controls people within the role group.

Recommended starting order:

1. Group Chef / executive kitchen roles
2. Kitchen Managers
3. Pizzaiolos / specialist roles
4. Kitchen team

## Salary privacy

Kitchen-manager payloads may contain hourly-team rates and hourly-team cost. They must not contain annual salary, fixed salary allocation, salary-derived rates or totals from which salary can be inferred.
