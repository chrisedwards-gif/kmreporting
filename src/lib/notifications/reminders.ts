export type ReminderKind = "report_initial" | "report_final" | "approval_review";

export function reminderContent(kind: ReminderKind, siteName?: string, weekEnd?: string) {
  const formattedWeekEnd = weekEnd
    ? new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" })
        .format(new Date(`${weekEnd}T00:00:00Z`))
    : null;
  const period = formattedWeekEnd ? ` for the week ending ${formattedWeekEnd}` : "";
  if (kind === "approval_review") return {
    subject: `Kitchen report awaiting approval${period}`,
    message: `A submitted kitchen report${siteName ? ` for ${siteName}` : ""} is waiting for management review. Open the approval queue to record a decision.`,
    actionPath: "/approvals",
  };
  if (kind === "report_final") return {
    subject: `Final reminder: weekly kitchen report due${period}`,
    message: `${siteName ?? "Your kitchen"} still has a weekly report outstanding. Please submit it or save a draft with a clear note before the deadline.`,
    actionPath: "/reports/new",
  };
  return {
    subject: `Weekly kitchen report due${period}`,
    message: `${siteName ?? "Your kitchen"} is due to complete its weekly report. Check sales, food purchases, labour and the short management update before submitting.`,
    actionPath: "/reports/new",
  };
}
