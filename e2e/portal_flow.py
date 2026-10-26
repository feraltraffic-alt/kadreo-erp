"""
Client portal end to end (spec 17.3 E2E-01 and the client half of E2E-02) against the
Docker Compose stand: the client orders staff, the back office accepts; the client disputes a
day and confirms the rest, the back office answers, the client confirms the timesheet.

    python e2e/portal_flow.py http://localhost:8082 http://localhost:8081

Without the back-office URL only the portal steps run (useful against the in-browser demo).
"""
import asyncio
import os
import re
import sys

from playwright.async_api import async_playwright, expect

PORTAL = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:8082"
OFFICE = sys.argv[2] if len(sys.argv) > 2 else None
OUT = os.path.join(os.path.dirname(__file__), "out")
os.makedirs(OUT, exist_ok=True)


async def main():
    problems = []
    async with async_playwright() as p:
        browser = await p.chromium.launch(args=["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"])

        async def new_page():
            page = await browser.new_page(viewport={"width": 1440, "height": 1000})
            page.on("pageerror", lambda e: problems.append(f"page error: {e}"))
            page.on("response", lambda r: problems.append(f"{r.status} {r.request.method} {r.url}") if r.status >= 500 else None)
            return page

        client = await new_page()
        office = await new_page() if OFFICE else None

        async def shot(page, name):
            await page.screenshot(path=os.path.join(OUT, f"portal_{name}.png"))

        try:
            # 1. Overview: one timesheet waits for the client.
            await client.goto(f"{PORTAL}/#/overview")
            await expect(client.get_by_text("1 табель").first).to_be_visible(timeout=30000)
            await shot(client, "1_overview")

            # 2. New request as on the 12.1 mock-up: 8 pickers, 28–30.10, 06:00–14:00, WMS + experience.
            await client.goto(f"{PORTAL}/#/requests/new")
            await expect(client.get_by_text("Итог заявки")).to_be_visible(timeout=15000)
            await client.fill("#nr-headcount", "8")
            await client.fill("#nr-to", "2026-10-30")
            await client.get_by_role("button", name="Сканер WMS").click()
            await client.get_by_role("button", name="Опыт на этом объекте").click()
            await client.fill("#nr-ref", "PO-2026-118")
            await expect(client.get_by_text("8 × 3 дня = 24")).to_be_visible(timeout=10000)
            await expect(client.get_by_text(re.compile(r"9\s216,00"))).to_be_visible()
            await shot(client, "2_new_request")
            await client.get_by_role("button", name="Отправить заявку").click()
            sent = client.get_by_text(re.compile(r"Заявка № (\d+) отправлена"))
            await expect(sent).to_be_visible(timeout=15000)
            number = re.search(r"№ (\d+)", await sent.inner_text()).group(1)
            await shot(client, "3_sent")

            if office:
                # 3. The back office sees and accepts it; the portal shows «В работе».
                await office.goto(f"{OFFICE}/#/requests")
                await office.get_by_role("button", name=number, exact=True).click()
                await expect(office.get_by_text("PO-2026-118").first).to_be_visible(timeout=15000)
                await office.get_by_role("button", name="Принять в работу").click()
                await expect(office.get_by_text("0/8").first).to_be_visible(timeout=15000)
                await client.goto(f"{PORTAL}/#/requests")
                await expect(client.get_by_text("В работе · 0 из 8").first).to_be_visible(timeout=15000)
                await shot(client, "4_requests")

            # 4. Hours to confirm: dispute one day, confirm the rest.
            await client.goto(f"{PORTAL}/#/timesheets")
            await client.get_by_text("Piotrków Tryb. · Hub").first.click()
            await expect(client.get_by_text("Подтвердите до 29.10, 23:59").first).to_be_visible(timeout=15000)
            await client.get_by_role("checkbox", name=re.compile("Выбрать строку")).nth(2).click()
            await client.select_option("#pt-reason", label="Работник был на объекте")
            await client.fill("#pt-hours", "8")
            await client.fill("#pt-comment", "Есть проходы по пропуску через наш турникет")
            await shot(client, "5_dispute_panel")
            await client.get_by_role("button", name="Оспорить выбранные (1)").click()
            await expect(client.get_by_text("Строки оспорены: 1").first).to_be_visible(timeout=15000)
            await client.get_by_role("button", name=re.compile("Подтвердить остальные")).click()
            await client.get_by_role("button", name="Подтвердить", exact=True).click()
            await expect(client.get_by_text("Часы подтверждены").first).to_be_visible(timeout=15000)
            await expect(client.get_by_text(re.compile("Оспорено строк: 1")).first).to_be_visible(timeout=15000)
            await shot(client, "6_disputed")

            if office:
                # 5. The back office rejects with an answer; the client confirms the whole timesheet.
                await office.goto(f"{OFFICE}/#/timesheets/disputes")
                await office.get_by_text("Piotrków Tryb. · Hub").first.click()
                await office.get_by_role("button", name="Отклонить", exact=True).click()
                await office.fill("#dsp-comment", "Работник был на смене, подтверждает старший смены")
                await office.get_by_role("button", name="Отклонить спор").click()
                await expect(office.get_by_text("Спор отклонён").first).to_be_visible(timeout=15000)

                await client.reload()
                await expect(client.get_by_text("Подтвердите до").first).to_be_visible(timeout=15000)
                await client.get_by_role("button", name=re.compile("Подтвердить все")).click()
                await client.get_by_role("button", name="Подтвердить", exact=True).click()
                await expect(client.get_by_text("Часы за период подтверждены").first).to_be_visible(timeout=15000)
                await shot(client, "7_confirmed")
        except Exception:
            await shot(client, "failure")
            if office:
                await shot(office, "failure_office")
            print("\n".join(problems))
            raise
        await browser.close()

    if problems:
        print("\n".join(problems))
        sys.exit(1)
    print("portal e2e OK")


asyncio.run(main())
