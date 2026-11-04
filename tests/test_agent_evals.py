import unittest

import agent_evals


class AgentEvalsTest(unittest.TestCase):
    def responses(self):
        return [
            {
                "case": prompt["case"],
                "choice": next(
                    key
                    for key, value in prompt["choices"].items()
                    if value == case[3][0]
                ),
                "reason": "Follow the maintained contract.",
            }
            for case, prompt in zip(
                agent_evals.CASES, agent_evals.prompts(), strict=True
            )
        ]

    def test_real_sources_and_positive_and_negative_decisions(self):
        prompts = list(agent_evals.prompts())
        self.assertEqual(len(prompts), 9)
        self.assertTrue(
            all(
                source["text"] and len(source["sha256"]) == 64
                for prompt in prompts
                for source in prompt["sources"]
            )
        )
        responses = self.responses()
        self.assertEqual(agent_evals.grade(responses)["passed"], 9)
        responses[0]["choice"] = "B"
        self.assertEqual(agent_evals.grade(responses)["passed"], 8)

    def test_missing_duplicate_and_untrusted_shapes_are_rejected(self):
        rows = self.responses()
        for invalid in (
            rows[:-1],
            rows + [rows[0]],
            [None],
            [{**row, "execute": "arbitrary command"} for row in rows],
            [{**row, "choice": True} for row in rows],
        ):
            with self.assertRaises(ValueError):
                agent_evals.grade(invalid)


if __name__ == "__main__":
    unittest.main()
