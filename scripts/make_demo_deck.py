#!/usr/bin/env python3
"""توليد عرض PDF تجريبي إنجليزي (12 شريحة) لاختبار مسار رفع العروض في «مسار»."""
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import inch
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer
from reportlab.lib.enums import TA_LEFT

SLIDES = [
    ("Seed Palestine — Smart Agriculture", [
        "Seed Palestine Smart Agriculture Ltd",
        "Intelligent irrigation for smallholder farms",
    ]),
    ("The Problem", [
        "Palestinian farmers consume 60% of water resources in flood irrigation",
        "Massive waste of water and time with weak crop yields",
    ]),
    ("Target Customer", [
        "Smallholder farmers owning 1-10 dunums",
        "Agricultural cooperatives in the West Bank and Gaza",
    ]),
    ("Our Solution", [
        "Seed platform: soil moisture sensors + mobile app",
        "Automatic water saving based on crop type",
        "Monthly subscription service model",
    ]),
    ("Market", [
        "Total addressable market TAM: 1.2 billion USD",
        "Serviceable available market SAM: 300 million",
        "SOM: 15 million",
    ]),
    ("Business Model", [
        "Monthly subscription 12 USD per farm",
        "Recurring revenues plus hardware sales",
    ]),
    ("Traction", [
        "500 active users",
        "40% monthly growth",
        "Monthly revenues 6000 USD",
    ]),
    ("Team", [
        "Team of 5 members",
        "Founder Sara — agricultural engineer",
        "Founder Ahmad — software developer",
    ]),
    ("Competition", [
        "Competitors: traditional irrigation systems",
        "Our edge: 30% cheaper and fit for small farms",
    ]),
    ("Roadmap", [
        "Regional expansion within 18 months",
        "Partnerships with 3 new cooperatives",
    ]),
    ("The Ask", [
        "We are raising 500,000 USD",
        "For a 10% equity stake",
    ]),
    ("Thank You", [
        "Thank you",
        "Seed — smarter irrigation, better harvest",
    ]),
]

def main():
    doc = SimpleDocTemplate(
        "/home/z/my-project/download/demo-pitch-deck.pdf",
        pagesize=letter,
        rightMargin=0.8 * inch, leftMargin=0.8 * inch,
        topMargin=1.0 * inch, bottomMargin=1.0 * inch,
        title="Seed Palestine — Demo Pitch Deck",
    )
    styles = getSampleStyleSheet()
    title_style = ParagraphStyle(
        "SlideTitle", parent=styles["Heading1"], fontSize=26, leading=32,
        spaceAfter=18, alignment=TA_LEFT, textColor="#0f3d2e",
    )
    body_style = ParagraphStyle(
        "SlideBody", parent=styles["BodyText"], fontSize=15, leading=24,
        spaceAfter=10,
    )
    story = []
    for title, lines in SLIDES:
        story.append(Spacer(1, 1.2 * inch))
        story.append(Paragraph(title, title_style))
        story.append(Spacer(1, 0.3 * inch))
        for line in lines:
            story.append(Paragraph(line, body_style))
        story.append(Spacer(1, 1.2 * inch))
    doc.build(story)
    print("PDF GENERATED: /home/z/my-project/download/demo-pitch-deck.pdf")

if __name__ == "__main__":
    main()
