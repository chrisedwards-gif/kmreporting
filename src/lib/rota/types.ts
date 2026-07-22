export type HistoricalSalesDay = {
  businessDate: string;
  netSales: number;
};

export type ForecastEvent = {
  eventDate: string;
  title: string;
  salesUpliftPct: number;
  source: "manual" | "calendar" | "bank_holiday" | "weather";
};

export type RotaDayRule = {
  weekday: number;
  openTime: string;
  closeTime: string;
  prepMinutes: number;
  closeMinutes: number;
  minimumStaff: number;
  maximumStaff: number;
  requiredSkills: string[];
  trading: boolean;
};

export type DemandPoint = {
  weekday: number;
  slotTime: string;
  demandWeight: number;
  source: "template" | "hourly_sales" | "manual";
};

export type StaffAvailabilityDay = {
  date: string;
  available: Array<{ startTime: string; endTime: string }>;
  unavailable: Array<{ startTime: string; endTime: string }>;
};

export type RotaStaffProfile = {
  id: string;
  employeeRef: string;
  rotacloudUserId: number | null;
  staffName: string;
  primaryRole: string;
  roleTitle: string;
  skills: string[];
  minimumWeeklyHours: number;
  targetWeeklyHours: number;
  maximumWeeklyHours: number;
  minimumShiftMinutes: number;
  maximumShiftMinutes: number;
  maximumConsecutiveDays: number;
  preferredDays: number[];
  preferredStart: string | null;
  preferredEnd: string | null;
  payBasis: "hourly" | "salaried";
  loadedHourlyRate: number;
  fixedWeeklyCost: number;
  costAllocationPct: number;
  availability?: StaffAvailabilityDay[];
};

export type ExistingStaffShift = {
  staffProfileId: string;
  shiftStart: string;
  shiftEnd: string;
};

export type ForecastDay = {
  businessDate: string;
  forecastSales: number;
  low: number;
  high: number;
  baseForecast: number;
  eventUpliftPct: number;
  historyValues: number[];
  excludedValues: number[];
  confidence: "high" | "medium" | "low" | "building_history";
};

export type SuggestedShift = {
  staffProfileId: string | null;
  staffName: string;
  roleTitle: string;
  shiftStart: string;
  shiftEnd: string;
  breakMinutes: number;
  paidMinutes: number;
  requiredSkill: string | null;
  assignmentReason: string;
  payBasis: "hourly" | "salaried" | "unfilled";
  privateCost: number;
  note?: string;
};

export type RotaPlanMark = {
  staffProfileId: string;
  businessDate: string;
  markType: "day_off" | "unavailable" | "leave" | "training";
  note: string;
};

export type RotaPlanDay = {
  businessDate: string;
  forecastSales: number;
  forecastLow: number;
  forecastHigh: number;
  labourBudget: number;
  fixedLabourCost: number;
  controllableBudget: number;
  plannedCost: number;
  plannedHours: number;
  peakTime: string | null;
  coverage: Array<{ slotTime: string; required: number; assigned: number; demandWeight: number }>;
  evidence: Record<string, unknown>;
  warnings: string[];
  shifts: SuggestedShift[];
};

export type RotaPlan = {
  weekStart: string;
  weekEnd: string;
  forecastSales: number;
  forecastLow: number;
  forecastHigh: number;
  labourTargetPct: number;
  labourBudget: number;
  plannedCost: number;
  plannedHours: number;
  accuracyMape: number | null;
  confidence: "high" | "medium" | "low" | "building_history";
  explanation: string;
  warnings: string[];
  days: RotaPlanDay[];
};

export type RotaPlanningInput = {
  weekStart: string;
  labourTargetPct: number;
  history: HistoricalSalesDay[];
  events: ForecastEvent[];
  dayRules: RotaDayRule[];
  demand: DemandPoint[];
  staff: RotaStaffProfile[];
  existingShifts?: ExistingStaffShift[];
  forecastWeeks?: number;
  minimumHistoryWeeks?: number;
  minimumRestHours?: number;
  intervalMinutes?: number;
  salesPerLabourHourTarget?: number;
};
