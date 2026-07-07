export interface AchievementConfig {
  id: string;
  title: string;
  hint: string;
  icon: string;
  rewardCoins: number;
}

export const ACHIEVEMENTS_CONFIG: AchievementConfig[] = [
  {
    id: "first-solve",
    title: "First Solve",
    hint: "Play your first match.",
    icon: "solar:cup-star-linear",
    rewardCoins: 25,
  },
  {
    id: "sharp-week",
    title: "Sharp Week",
    hint: "Play five matches in one week.",
    icon: "solar:bolt-linear",
    rewardCoins: 50,
  },
  {
    id: "daily_discipline",
    title: "Daily Discipline",
    hint: "Reach a 7-day daily streak.",
    icon: "solar:calendar-minimalistic-linear",
    rewardCoins: 75,
  },
  {
    id: "clutch_finish",
    title: "Clutch Finish",
    hint: "Complete 20 competitive matches in under 30 seconds.",
    icon: "solar:stopwatch-play-linear",
    rewardCoins: 100,
  },
  {
    id: "perfect_run",
    title: "Perfect Run",
    hint: "Get 21 perfect rounds (100% accuracy) within 30 days.",
    icon: "solar:fire-square-linear",
    rewardCoins: 150,
  },
  {
    id: "top_performer_this_week",
    title: "Top Performer",
    hint: "Earn the most XP this week.",
    icon: "solar:medal-ribbons-linear",
    rewardCoins: 200,
  },
];
