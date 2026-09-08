import type { FundContributionSink } from "@/modules/payroll/application/ports";
import {
  createPayrollContributionSink,
  type PayrollContributionSinkRepositories,
} from "./payroll-contribution-sink";
import {
  MemoryContributionsRepository,
  MemoryFundsRepository,
  MemorySchedulesRepository,
} from "./memory-repositories";

export function memoryPayrollContributionSink(
  repositories: PayrollContributionSinkRepositories,
): FundContributionSink {
  return createPayrollContributionSink(repositories);
}

/** A complete memory adapter for payroll tests whose scenario has no funds. */
export class MemoryFundContributionSink implements FundContributionSink {
  private readonly sink: FundContributionSink;

  constructor(repositories: PayrollContributionSinkRepositories = {
    funds: new MemoryFundsRepository(),
    schedules: new MemorySchedulesRepository(),
    contributions: new MemoryContributionsRepository(),
  }) {
    this.sink = memoryPayrollContributionSink(repositories);
  }

  writeForRecord(input: Parameters<FundContributionSink["writeForRecord"]>[0]) {
    return this.sink.writeForRecord(input);
  }
}
