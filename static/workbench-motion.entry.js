import { gsap } from 'gsap';
import { Flip } from 'gsap/Flip';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { initWorkbenchMotion } from './workbench-motion.js';

gsap.registerPlugin(Flip, ScrollTrigger);
initWorkbenchMotion(gsap, Flip, ScrollTrigger);
