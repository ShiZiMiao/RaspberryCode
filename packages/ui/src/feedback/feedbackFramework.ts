import {
  DEFAULT_FEEDBACK_TICKET_FRAMEWORK,
  type RaspberryCodeProvider,
  type FeedbackTicketFramework,
} from "@raspberrycode/shared";

export function inferFeedbackFrameworkFromAgentProvider(
  _provider: RaspberryCodeProvider | null | undefined,
): FeedbackTicketFramework {
  return DEFAULT_FEEDBACK_TICKET_FRAMEWORK;
}
