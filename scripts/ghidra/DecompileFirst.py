# Ghidra headless post-script (Jython): decompile the first real function of
# the imported program to pseudo-C and print it. Used by the heavy smoke test
# to prove analyzeHeadless produces decompiled C.
#
# Invoked by:
#   analyzeHeadless <proj_dir> smoke -import <binary> \
#       -scriptPath /work -postScript DecompileFirst.py
from ghidra.app.decompiler import DecompInterface
from ghidra.util.task import ConsoleTaskMonitor

prog = currentProgram
di = DecompInterface()
di.openProgram(prog)

fm = prog.getFunctionManager()
funcs = [f for f in fm.getFunctions(True) if not f.isExternal()]

if not funcs:
    print("SMOKE-DECOMPILE: no functions found")
else:
    f = funcs[0]
    res = di.decompileFunction(f, 60, ConsoleTaskMonitor())
    if res and res.decompileCompleted():
        print("=== PSEUDO-C for %s ===" % f.getName())
        print(res.getDecompiledFunction().getC())
        print("SMOKE-DECOMPILE: OK")
    else:
        print("SMOKE-DECOMPILE: decompile failed")
