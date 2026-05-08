def reflect_and_refine(task: str, criteria: list[str], max_iterations: int = 3) -> str:
    """Generate with reflection loop."""
    output = llm(f"Complete this task:\n{task}")
    
    for i in range(max_iterations):
        # Self-critique
        critique = llm(f"""
        Evaluate this output against criteria: {criteria}
        Output: {output}
        Rate each: PASS/FAIL with feedback as JSON.
        """)
        
        critique_data = json.loads(critique)
        all_pass = all(c["status"] == "PASS" for c in critique_data.values())
        if all_pass:
            return output
        
        # Refine based on critique
        failed = {k: v["feedback"] for k, v in critique_data.items() if v["status"] == "FAIL"}
        output = llm(f"Improve to address: {failed}\nOriginal: {output}")
    
    return output
