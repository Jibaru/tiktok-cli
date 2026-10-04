import type { Command } from "../core/command.ts";
import { commandName } from "../core/command.ts";
import { SCHEMA_VERSION, VERSION } from "../core/version.ts";
import { analyticsOverview } from "./analytics.ts";
import { authLogin, authLogout, authStatus } from "./auth.ts";
import { commentInbox, commentList, commentReply } from "./comment.ts";
import { doctor } from "./doctor.ts";
import { intentApprove, intentDiscard, intentList } from "./intent.ts";
import { videoPost } from "./post.ts";
import { videoDelete, videoUpdate } from "./video-edit.ts";
import { killswitchOff, killswitchOn } from "./killswitch.ts";
import { videoGet, videoList } from "./video.ts";

const schema: Command = {
  path: ["schema", "show"],
  shorthand: "schema",
  summary: "Describe every command, its arguments, flags and output shape.",
  args: [{ name: "command", description: 'Optional command, e.g. "video list"', required: false }],
  flags: [],
  gated: false,
  output: "{ version, schemaVersion, commands: CommandSchema[] }",
  async run(ctx) {
    const wanted = ctx.args.join(" ");
    const described = commands
      .filter((command) => !wanted || commandName(command) === wanted)
      .map((command) => ({
        name: commandName(command),
        shorthand: command.shorthand,
        summary: command.summary,
        args: command.args,
        flags: command.flags,
        gated: command.gated,
        output: command.output,
      }));
    return { data: { version: VERSION, schemaVersion: SCHEMA_VERSION, commands: described } };
  },
};

export const commands: Command[] = [
  videoList,
  videoGet,
  videoPost,
  videoUpdate,
  videoDelete,
  analyticsOverview,
  commentList,
  commentInbox,
  commentReply,
  authLogin,
  authStatus,
  authLogout,
  intentList,
  intentApprove,
  intentDiscard,
  killswitchOn,
  killswitchOff,
  doctor,
  schema,
];
