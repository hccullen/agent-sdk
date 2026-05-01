"""
08 — JSON DSL workflow config.

Define the full agent topology as a plain dict (or load it from a .json file),
then hand it to ``from_config()`` which creates all agents concurrently and
returns a ready-to-run ``Workflow``.

This is an alternative to the code-first ``workflow()`` API — both can be
used in the same project.
"""
import asyncio
import os

from corti_agent_sdk import AgentsClient, from_config
from corti_agent_sdk.client import CortiClient

CONFIG = {
    "agents": [
        {
            "name": "wfc-summarizer",
            "description": "Summarises a clinical note in one sentence.",
            "systemPrompt": "Summarise the note in a single sentence.",
        },
        {
            "name": "wfc-classifier",
            "description": "Classifies a summary as 'urgent' or 'routine'.",
            "systemPrompt": "Reply with exactly one word: 'urgent' or 'routine'. No punctuation.",
        },
        {
            "name": "wfc-differential",
            "description": "Lists a differential diagnosis.",
            "systemPrompt": "List the top 3 differential diagnoses, most likely first. One line each.",
        },
        {
            "name": "wfc-redflags",
            "description": "Flags symptoms warranting urgent evaluation.",
            "systemPrompt": "List any red-flag features from the presentation. One line each.",
        },
        {
            "name": "wfc-escalator",
            "description": "Drafts an escalation for urgent cases.",
            "systemPrompt": "Draft a one-line escalation to the on-call physician.",
        },
    ],
    "workflow": [
        # Step 1: summarise the note
        "wfc-summarizer",
        # Step 2: classify as urgent or routine
        "wfc-classifier",
        # Step 3: fan out differential + red-flags in parallel (only for urgent cases)
        {"parallel": ["wfc-differential", "wfc-redflags"]},
        # Step 4: escalate — only when the classifier flagged the case as urgent
        {
            "agent": "wfc-escalator",
            "when": {"text": {"includes": "urgent"}},
            "retries": 2,
            "retryDelay": 500,
        },
    ],
}


async def main() -> None:
    async with CortiClient(
        tenant_name=os.environ["CORTI_TENANT"],
        environment=os.environ.get("CORTI_ENV", "eu"),
        auth={
            "client_id": os.environ["CORTI_CLIENT_ID"],
            "client_secret": os.environ["CORTI_CLIENT_SECRET"],
        },
    ) as client:
        agents = AgentsClient(client)

        wf = await from_config(CONFIG, agents)

        note = "Patient reports severe chest pain radiating to left arm, onset 30 minutes ago."

        result = await wf.run(note)

        print("Final output:", result.output.text)
        print("Steps executed:", len(result.steps))
        print("Stopped early:", result.stopped_early)


asyncio.run(main())
