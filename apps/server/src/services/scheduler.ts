export type DaypartPlan = {
  nowLabel: string;
  recommendation: string;
  schedulerTrace: string;
};

function getDaypart(hours: number) {
  if (hours >= 5 && hours < 9) {
    return "morning";
  }
  if (hours >= 9 && hours < 12) {
    return "work-start";
  }
  if (hours >= 12 && hours < 14) {
    return "noon";
  }
  if (hours >= 14 && hours < 18) {
    return "afternoon";
  }
  if (hours >= 18 && hours < 23) {
    return "night";
  }
  return "late-night";
}

export function getCurrentDaypartPlan(date = new Date()): DaypartPlan {
  const hours = date.getHours();
  const daypart = getDaypart(hours);

  switch (daypart) {
    case "morning":
      return {
        nowLabel: "清晨",
        recommendation: "适合从轻盈、透明、慢启动的歌开始，不要一上来就过满。",
        schedulerTrace: "07:00 morning warm-up"
      };
    case "work-start":
      return {
        nowLabel: "上午",
        recommendation: "适合清晰、专注、节奏稳定的顺序，避免情绪过载。",
        schedulerTrace: "09:00 focus check"
      };
    case "noon":
      return {
        nowLabel: "中午",
        recommendation: "适合短时恢复精力，保留亮度，但不要太吵。",
        schedulerTrace: "12:30 noon reset"
      };
    case "afternoon":
      return {
        nowLabel: "下午",
        recommendation: "适合平稳推进，兼顾效率和耐听，不要过早进入深夜气质。",
        schedulerTrace: "15:00 afternoon pacing"
      };
    case "night":
      return {
        nowLabel: "夜晚",
        recommendation: "适合更私人、更有叙事感的排法，可以适度放慢呼吸。",
        schedulerTrace: "20:00 narrative mode"
      };
    default:
      return {
        nowLabel: "深夜",
        recommendation: "适合收敛、克制、少刺激，优先连贯和陪伴感。",
        schedulerTrace: "00:00 late-night protection"
      };
  }
}
