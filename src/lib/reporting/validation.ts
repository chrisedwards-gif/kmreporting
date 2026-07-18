import { z } from "zod";

export const optionalNumericInput = z.preprocess(
  (value) => value === "" || value === null || value === undefined ? 0 : value,
  z.coerce.number().finite(),
);
