import { describe, expect, it } from "vitest";
import { noticeKeyForError } from "./appFeedback";

describe("noticeKeyForError", () => {
  it("maps known technical errors to translation keys", () => {
    expect(noticeKeyForError(new Error("Backup file is not valid JSON"))).toEqual(
      { messageKey: "notice.backupNotJSON" }
    );
    expect(noticeKeyForError("page cannot be moved under itself")).toEqual(
      { messageKey: "notice.pageCannotMoveUnderItself" }
    );
    expect(noticeKeyForError("EACCES: permission denied")).toEqual(
      { messageKey: "notice.noPermission" }
    );
  });

  it("uses a rawMessage fallback for unknown errors", () => {
    expect(noticeKeyForError({ nope: true })).toEqual(
      { messageKey: "notice.somethingWentWrong" }
    );
  });

  it("does not treat every denied message as a permission error", () => {
    // "request denied by validation" doesn't contain "permission denied" or "access denied"
    // so it falls through to rawMessage (the original error message)
    const result = noticeKeyForError("request denied by validation");
    expect(result).toEqual({ rawMessage: "request denied by validation" });
  });
});
