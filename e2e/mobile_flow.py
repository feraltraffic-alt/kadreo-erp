"""
Mobile app and kiosk end to end (spec 14) in the web build of the Expo app:

    python e2e/mobile_flow.py http://localhost:8083

Worker (14.1): break and back, accept an urgent offer, kiosk QR. Team leader (14.2): manual
clock-in for a worker outside the geofence, replacement request, shift output. Manager (14.3):
approve a decision with the 5-second undo window, offer a replacement. Kiosk (14.4): PIN of a
no-show (late), PIN of a worker on shift (action choice). Works against the in-browser demo and
against the Docker Compose stand (same seed, same names).
"""
import asyncio
import os
import re
import sys

from playwright.async_api import async_playwright, expect

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:8083"
OUT = os.path.join(os.path.dirname(__file__), "out")
os.makedirs(OUT, exist_ok=True)


async def main():
    problems = []
    async with async_playwright() as p:
        browser = await p.chromium.launch(args=["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"])

        async def open_as(who, w=390, h=844):
            ctx = await browser.new_context(viewport={"width": w, "height": h}, permissions=["camera"])
            page = await ctx.new_page()
            page.on("pageerror", lambda e: problems.append(f"{who} page error: {e}"))
            page.on("response", lambda r: problems.append(f"{who} {r.status} {r.request.method} {r.url}") if r.status >= 500 else None)
            await page.goto(f"{BASE}/?as={who}")
            return page

        async def shot(page, name):
            await page.screenshot(path=os.path.join(OUT, f"mobile_{name}.png"))

        page = None
        try:
            # 1. Worker: on shift since the morning; break and back; accept the urgent offer for 28.10.
            page = await open_as("worker")
            await expect(page.get_by_text("Доброе утро, Viktor")).to_be_visible(timeout=30000)
            await expect(page.get_by_text(re.compile(r"Смена идёт \d+:\d\d"))).to_be_visible(timeout=15000)
            await expect(page.get_by_text("Внутри геозоны · точность 18 м")).to_be_visible(timeout=15000)
            await shot(page, "1_worker")
            await page.get_by_role("button", name="Перерыв", exact=True).click()
            await expect(page.get_by_text(re.compile(r"Перерыв начат в \d\d:\d\d"))).to_be_visible(timeout=15000)
            await page.get_by_role("button", name="Вернуться к работе").click()
            await expect(page.get_by_text(re.compile(r"С возвращением! Работа с \d\d:\d\d"))).to_be_visible(timeout=15000)
            offer = page.get_by_test_id("shift-2026-10-28")
            await expect(offer.get_by_text(re.compile("Новое предложение"))).to_be_visible()
            await offer.get_by_role("button", name="Принять").click()
            await expect(page.get_by_test_id("shift-2026-10-28").get_by_text("Подтверждена")).to_be_visible(timeout=15000)
            await page.get_by_role("tab", name="Профиль").click()
            await page.get_by_role("button", name="QR для киоска").click()
            await expect(page.get_by_text(re.compile(r"Код обновится через \d+ с"))).to_be_visible(timeout=15000)
            await shot(page, "2_worker_qr")
            await page.context.close()

            # 2. Team leader: manual clock-in for the worker whose GPS failed, replacement, output.
            page = await open_as("leader")
            await expect(page.get_by_text("Требуют внимания · 5")).to_be_visible(timeout=30000)
            await shot(page, "3_leader")
            pawlak = page.get_by_test_id("member-W-00950")
            await expect(pawlak.get_by_text(re.compile("GPS вне зоны"))).to_be_visible()
            await pawlak.get_by_role("button", name="Отметить вручную").click()
            await page.get_by_role("button", name="Отправить на согласование").click()
            await expect(page.get_by_text("Ручная отметка отправлена на согласование")).to_be_visible(timeout=15000)
            await expect(page.get_by_test_id("member-W-00950").get_by_text(re.compile("на согласовании"))).to_be_visible()
            hnatiuk = page.get_by_test_id("member-W-00046")
            await hnatiuk.get_by_role("button", name="Запросить замену").click()
            await expect(page.get_by_text("Запрос замены отправлен менеджеру")).to_be_visible(timeout=15000)
            await expect(page.get_by_test_id("member-W-00046").get_by_text("Ищем замену")).to_be_visible()
            await page.get_by_role("button", name="Внести").click()
            await page.get_by_label("Сделано, строк").fill("1200")
            await page.get_by_role("button", name="Сохранить").click()
            await expect(page.get_by_text(re.compile(r"^1200 · 33% · план на"))).to_be_visible(timeout=15000)
            await shot(page, "4_leader_done")
            await page.context.close()

            # 3. Manager: approve the forgotten clock-in (undo window), offer a replacement in Stryków.
            page = await open_as("manager")
            await expect(page.get_by_text("Укомплектованность сейчас")).to_be_visible(timeout=30000)
            await shot(page, "5_manager")
            await page.get_by_role("button", name="Одобрить: Nika Kapanadze").click()
            await expect(page.get_by_text("Одобрено", exact=True)).to_be_visible()
            await expect(page.get_by_role("button", name="Отменить")).to_be_visible()
            await page.wait_for_timeout(6500)
            await expect(page.get_by_role("button", name="Одобрить: Nika Kapanadze")).to_have_count(0)
            await page.get_by_role("button", name="Найти замену").first.click()
            await page.get_by_role("checkbox").first.click()
            await page.get_by_role("button", name="Предложить (1)").click()
            await expect(page.get_by_text("Предложение отправлено: 1")).to_be_visible(timeout=15000)
            await shot(page, "6_manager_done")
            await page.context.close()

            # 4. Kiosk: a no-show arrives late (yellow), Viktor goes on a break (choice of action).
            page = await open_as("kiosk", 1280, 800)
            await expect(page.get_by_text("Последние отметки")).to_be_visible(timeout=30000)

            async def pin(number, code):
                await page.get_by_role("button", name="Ввести PIN").click()
                for d in number:
                    await page.get_by_role("button", name=d, exact=True).click()
                await page.get_by_role("button", name="Продолжить").click()
                for d in code:
                    await page.get_by_role("button", name=d, exact=True).click()

            await pin("49", "000049")
            result = page.get_by_test_id("kiosk-result")
            await expect(result.get_by_text(re.compile(r"Отметка принята · опоздание \d+ мин"))).to_be_visible(timeout=15000)
            await expect(result.get_by_text("Iryna N.")).to_be_visible()
            await shot(page, "7_kiosk_late")
            await pin("12", "000012")
            await page.get_by_role("button", name="Перерыв").click()
            await expect(result.get_by_text("Viktor H.")).to_be_visible(timeout=15000)
            await expect(result.get_by_text(re.compile(r"Перерыв с \d\d:\d\d"))).to_be_visible()
            await shot(page, "8_kiosk_break")
            await pin("12", "111111")
            await expect(page.get_by_text("Неверный номер или PIN. Осталось попыток: 4")).to_be_visible(timeout=15000)
            await page.get_by_role("button", name="Отмена").click()
            await page.context.close()
        except Exception:
            if page and not page.is_closed():
                await shot(page, "failure")
            print("\n".join(problems))
            raise
        await browser.close()

    if problems:
        print("\n".join(problems))
        sys.exit(1)
    print("mobile e2e OK")


asyncio.run(main())
