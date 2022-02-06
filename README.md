# companion-module-ipl-ocp

This Module allows for control and feedback from Inkling Performance Labs' 
[Overlay Control Panel](https://github.com/inkfarer/ipl-overlay-controls)

This module currently tested on IPL-OCP 3.2.0, 4.0.0

*This module does not support nodeCG instances with login enabled*

For the available functions of this module view the **HELP.md** file.

## How does it work
This module connects into the `socket.io` server created my [NodeCG](https://www.nodecg.dev/) and replicates the message,
operations and assignments that the IPL OCP does. This allows us to hook into the control panel replicants without adding
any extra middle-man software to maintain on the overlays side
