type DatabaseError = {
  code?: string;
  message?: string;
};

const genericSaveError = "The report could not be saved. Check your site access and try again.";

export function reportSaveErrorMessage(error: DatabaseError, isPreview: boolean) {
  const message = error.message?.replace(/\s+/g, " ").trim() ?? "";
  const normalised = message.toLowerCase();

  if (normalised.includes("site access denied")) {
    return "You do not have permission to submit reports for this kitchen.";
  }
  if (normalised.includes("submitted or approved report cannot be overwritten")) {
    return "A submitted or approved report already exists for this kitchen and week.";
  }
  if (normalised.includes("required weekly source totals are not confirmed")) {
    return "The confirmed sales, purchasing and labour totals are incomplete.";
  }
  if (normalised.includes("reporting period must be sunday to saturday")) {
    return "The database rejected the reporting period. It must run from Sunday through Saturday.";
  }
  if (error.code === "23503") {
    return "Your user profile or kitchen setup is incomplete. Ask an administrator to check the site assignment.";
  }
  if (error.code === "23514") {
    return "One of the report totals conflicts with a database validation rule.";
  }

  if (!isPreview) return genericSaveError;

  const safeCode = /^[A-Z0-9]{1,12}$/i.test(error.code ?? "") ? ` ${error.code}` : "";
  const safeMessage = message.slice(0, 240) || "Unknown database failure";
  return `UAT database error${safeCode}: ${safeMessage}`;
}
