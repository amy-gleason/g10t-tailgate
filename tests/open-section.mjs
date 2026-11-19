export async function openSection(page, section) {
  const tabFor = { coming: "rsvp", food: "bring", drinks: "bring", donations: "bring", other: "bring", photos: "photos", posts: "messages" };
  const tabName = tabFor[section] || section;
  const tab = await page.$(`[data-job-tab="${tabName}"]`);
  if (tab) {
    const visible = await tab.evaluate((node) => {
      const style = getComputedStyle(node);
      const rect = node.getBoundingClientRect();
      return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
    });
    if (visible) {
      await tab.click();
      return;
    }
  }
  await page.click(`[data-section="${section}"] .acc-toggle`);
}
