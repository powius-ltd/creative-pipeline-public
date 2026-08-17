/**
 * Thrown by an agent's real (non-mock) implementation when the work can only be
 * done by a Claude Code operator — an MCP-only tool (Higgsfield) or a CLI the
 * operator owns the OAuth session for (gemini). stateMachine.advanceRun catches
 * this specifically (not as a generic error) and parks the run in
 * 'awaiting_operator' with `instructions` surfaced in the dashboard.
 */
export class OperatorRequiredError extends Error {
  constructor(public instructions: string) {
    super(instructions);
    this.name = "OperatorRequiredError";
  }
}
