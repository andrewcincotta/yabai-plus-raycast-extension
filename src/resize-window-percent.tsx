import { Action, ActionPanel, closeMainWindow, Form, Icon, showToast, Toast } from "@raycast/api";
import { getFocusedWindow, resizeCenteredOnDisplay, triggerSketchybar } from "./yabai";

type FormValues = {
  percent: string;
};

export default function Command() {
  async function resizeWindow({ percent }: FormValues) {
    const trimmedPercent = percent.trim();

    if (!/^\d+$/.test(trimmedPercent) || Number(trimmedPercent) < 1 || Number(trimmedPercent) > 100) {
      await showToast({
        style: Toast.Style.Failure,
        title: "Enter a whole percentage from 1 to 100",
      });
      return;
    }

    try {
      const window = await getFocusedWindow();
      await resizeCenteredOnDisplay(window.id, window.display, Number(trimmedPercent), "rectangle");
      await triggerSketchybar("window_focus");
      await showToast({
        style: Toast.Style.Success,
        title: "Window resized and centered",
        message: `${trimmedPercent}% of display`,
      });
      await closeMainWindow();
    } catch (error) {
      console.error("Failed to resize active window", error);
      await showToast({
        style: Toast.Style.Failure,
        title: "Unable to resize window",
        message: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }

  return (
    <Form
      navigationTitle="Resize Window %"
      actions={
        <ActionPanel>
          <Action.SubmitForm title="Resize & Center Window" icon={Icon.ArrowsContract} onSubmit={resizeWindow} />
        </ActionPanel>
      }
    >
      <Form.TextField
        id="percent"
        title="Display Percentage"
        placeholder="e.g. 70"
        info="Enter a whole percentage from 1 to 100."
        autoFocus
      />
    </Form>
  );
}
