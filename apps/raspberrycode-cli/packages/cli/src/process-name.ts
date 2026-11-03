export const CLI_COMMAND_NAME = "raspberrycode";
export const CLI_PROCESS_NAME = "raspberrycode-cli";

interface ProcessTitleTarget {
  title: string;
}

export const setCliProcessTitle = (
  target: ProcessTitleTarget = process,
): void => {
  target.title = CLI_PROCESS_NAME;
};
