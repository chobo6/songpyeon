import { beforeEach, describe, expect, test } from "vitest";
import { _resetForTest, getInquiries, recordInquiry } from "./inquiries";

describe("inquiries", () => {
  beforeEach(() => {
    _resetForTest();
  });

  test("returns recorded inquiries newest first", () => {
    recordInquiry(1, "차은우", "제목1", "내용1");
    recordInquiry(2, "장원영", "제목2", "내용2");

    const inquiries = getInquiries();
    expect(inquiries.map((i) => i.title)).toEqual(["제목2", "제목1"]);
  });

  test("stores the submitter's userId and nickname alongside the message", () => {
    recordInquiry(42, "테스트유저", "제목", "내용");

    const [inquiry] = getInquiries();
    expect(inquiry.userId).toBe(42);
    expect(inquiry.nickname).toBe("테스트유저");
    expect(inquiry.title).toBe("제목");
    expect(inquiry.content).toBe("내용");
  });
});
